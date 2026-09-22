import { IDeviceData } from '@ha/IDeviceData';
import { Dictionary } from '@utils/Dictionary';
import { logError, logInfo, logWarn } from '@utils/logger';
import { seconds } from '@utils/seconds';
import { IController } from 'Common/IController';
import { IEventSource } from 'Common/IEventSource';
import { IBLEDevice } from 'ESPHome/types/IBLEDevice';
import EventEmitter from 'events';

// Unlike other Reverie control boxes, this module exposes each function (presets,
// head motor, foot motor, light) as its own GATT characteristic rather than a single
// shared write characteristic carrying different command bytes. RevCBCommand carries
// which named target to write to; controllerBuilder resolves target names to the
// actual characteristic handles for this device.
//
// 'headPosition'/'footPosition' are dual-purpose: the same characteristic used for
// live position notify is also writable, and writing a target byte there drives the
// motor to that position autonomously (the device closes the loop itself and stops
// on its own - confirmed via live capture of the official app's position slider).
// 'headMotor'/'footMotor' remain for the separate hold-to-move/stop control (used to
// interrupt an in-progress move).
export type RevCBTarget = 'preset' | 'headMotor' | 'footMotor' | 'headPosition' | 'footPosition' | 'light';
export type RevCBCommand = { target: RevCBTarget; value: number[] };

// Targets that physically move the bed, and so should produce position notifications shortly
// after. The light doesn't move anything, so it tells us nothing about notification health.
const MOVEMENT_TARGETS: RevCBTarget[] = ['preset', 'headMotor', 'footMotor', 'headPosition', 'footPosition'];
const NOTIFICATION_GRACE = seconds(5);
const NOTIFY_REFRESH_COOLDOWN = seconds(60);

export class RevCBController extends EventEmitter implements IEventSource, IController<RevCBCommand> {
  cache: Dictionary<object> = {};
  private lastPositions: Dictionary<number> = {};
  private notifiedKeys = new Set<string>();
  private hasNotifyHandles = false;
  private lastNotificationAt = 0;
  private lastNotifyRefreshAt = 0;
  private notificationCheckTimer?: NodeJS.Timeout;

  // Unlike BLEController, this controller never disconnects once connected (see writeCommands) -
  // it's always meant to stay connected persistently. BLE/setupConnectionAvailability uses this
  // to decide whether to wire up device-level MQTT availability for the connection.
  readonly isPersistentConnection = true;

  constructor(
    public deviceData: IDeviceData,
    private bleDevice: IBLEDevice,
    private targetHandles: Dictionary<number>,
    notifyHandles: Dictionary<number> = {}
  ) {
    super();
    Object.entries(notifyHandles).forEach(([key, handle]) => {
      // Logged either way: if enabling notifications fails, everything downstream of it (live
      // position sensors, the position covers' reported position, memory-slot capture) silently
      // stops updating with no other symptom, which is near-impossible to tell apart from the
      // bed simply not reporting anything.
      this.bleDevice.subscribeToCharacteristic(handle, (data) => {
        // Logged once per key, so "notifications were enabled" and "the bed is actually sending
        // data on them" are distinguishable - they fail in exactly the same silent way otherwise.
        if (!this.notifiedKeys.has(key)) {
          this.notifiedKeys.add(key);
          logInfo('[Reverie] First notification received:', key, data[0]);
        }
        this.lastNotificationAt = Date.now();
        this.lastPositions[key] = data[0];
        this.emit(key, data);
      }).then(
        () => logInfo('[Reverie] Subscribed to notifications:', key),
        (e) => logError(`[Reverie] Failed to subscribe to notifications for '${key}' - live updates from it will not work`, e)
      );
    });
    this.hasNotifyHandles = Object.keys(notifyHandles).length > 0;
    this.bleDevice.startHealthMonitoring();
  }

  // Last known value seen on a notify key (e.g. 'headPosition'/'footPosition') -
  // used to capture the bed's current position at the moment a Program Memory button
  // is pressed, since the device itself never reports what's stored in a memory slot.
  getLastPosition = (key: string): number | undefined => this.lastPositions[key];

  writeCommand = async (command: RevCBCommand) => this.writeCommands([command]);

  writeCommands = async (commands: RevCBCommand[]) => {
    await this.bleDevice.connect();
    for (const command of commands) {
      const handle = this.targetHandles[command.target];
      if (handle === undefined) continue;
      try {
        // Logged so a command that reached the add-on is visible in the log even when it succeeds.
        // Without this, "pressed a button and nothing happened" is indistinguishable from "the
        // press never arrived" - both are silent, which cost a diagnostic round trip to work out.
        logInfo('[Reverie] Writing command:', command.target, command.value);
        await this.bleDevice.writeCharacteristic(handle, new Uint8Array(command.value));
      } catch (e) {
        logError('[Reverie] Failed to write characteristic', e);
      }
      if (MOVEMENT_TARGETS.includes(command.target)) this.expectNotifications();
    }
  };

  // The periodic health check proves the *connection* is alive, but nothing proves *notifications*
  // are - and those fail independently and completely silently (writes keep working while every
  // live-feedback entity quietly freezes). Anything that moves the bed should produce position
  // notifications within a moment, so that's a free, reliable moment to check. If none arrive,
  // re-enable them rather than waiting for someone to notice the sliders have stopped moving.
  private expectNotifications = () => {
    if (!this.hasNotifyHandles) return;
    const writtenAt = Date.now();
    clearTimeout(this.notificationCheckTimer);
    this.notificationCheckTimer = setTimeout(() => void this.verifyNotifications(writtenAt), NOTIFICATION_GRACE);
  };

  private verifyNotifications = async (writtenAt: number) => {
    if (this.lastNotificationAt >= writtenAt) return; // data arrived, nothing to do

    // A command that moved nothing (e.g. a preset the bed is already in) legitimately produces no
    // notifications, so this can fire without anything being wrong. Re-subscribing is idempotent
    // and cheap, so a false positive costs nothing - but rate-limit it anyway so a genuinely idle
    // bed can't turn into a stream of re-subscribes.
    if (Date.now() - this.lastNotifyRefreshAt < NOTIFY_REFRESH_COOLDOWN) return;
    this.lastNotifyRefreshAt = Date.now();

    logWarn('[Reverie] No position updates after a movement command - re-enabling notifications');
    try {
      await this.bleDevice.refreshNotifySubscriptions();
    } catch (e) {
      logError('[Reverie] Failed to re-enable notifications', e);
    }
  };

  // A single write is all it takes for either the hold-to-move motor commands or the
  // autonomous move-to-position commands - nothing here needs to be resent
  // periodically to keep working, so there's no repeating command timer to cancel.
  cancelCommands = async () => {};

  on = (eventName: string, handler: (data: Uint8Array) => void): this => {
    this.addListener(eventName, handler);
    return this;
  };
}
