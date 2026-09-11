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
export type RevCBTarget = 'preset' | 'headMotor' | 'footMotor' | 'light';
export type RevCBCommand = { target: RevCBTarget; value: number[] };

export class RevCBController extends EventEmitter implements IEventSource, IController<RevCBCommand> {
  cache: Dictionary<object> = {};

  constructor(
    public deviceData: IDeviceData,
    private bleDevice: IBLEDevice,
    private targetHandles: Dictionary<number>,
    notifyHandles: Dictionary<number> = {}
  ) {
    super();
    Object.entries(notifyHandles).forEach(([key, handle]) => {
      void this.bleDevice.subscribeToCharacteristic(handle, (data) => this.emit(key, data));
    });
  }

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

  // The motors here run continuously once started until an explicit stop command is
  // written (no device-side "move to position X" support), so there's no repeating
  // command timer to cancel.
  cancelCommands = async () => {};

  on = (eventName: string, handler: (data: Uint8Array) => void): this => {
    this.addListener(eventName, handler);
    return this;
  };
}
