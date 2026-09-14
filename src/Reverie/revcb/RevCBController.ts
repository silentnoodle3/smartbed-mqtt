import { IDeviceData } from '@ha/IDeviceData';
import { Dictionary } from '@utils/Dictionary';
import { logError } from '@utils/logger';
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

export class RevCBController extends EventEmitter implements IEventSource, IController<RevCBCommand> {
  cache: Dictionary<object> = {};
  private lastPositions: Dictionary<number> = {};

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
      void this.bleDevice.subscribeToCharacteristic(handle, (data) => {
        this.lastPositions[key] = data[0];
        this.emit(key, data);
      });
    });
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
        await this.bleDevice.writeCharacteristic(handle, new Uint8Array(command.value));
      } catch (e) {
        logError('[Reverie] Failed to write characteristic', e);
      }
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
