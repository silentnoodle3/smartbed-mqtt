import { IDeviceData } from '@ha/IDeviceData';
import { Dictionary } from '@utils/Dictionary';
import { logError } from '@utils/logger';
import { IBLEDevice } from 'ESPHome/types/IBLEDevice';
import EventEmitter from 'events';

interface ECBHandles {
  headWrite:  number;
  footWrite:  number;
  light:      number;
  headNotify: number;
  footNotify: number;
}

// Custom controller for the Reverie ECB2208E1 control box.
//
// This device uses a different paradigm from other supported beds:
// instead of a single command characteristic with a framing protocol,
// each function has its own dedicated GATT characteristic. We write
// position values directly; the bed moves autonomously to the target
// and notifies us of current position as it moves.
//
// The standard BLEController cannot support this (it is single-handle),
// so we implement a lightweight custom controller here.
export class ECBController extends EventEmitter {
  cache: Dictionary<Object> = {};

  constructor(
    public deviceData: IDeviceData,
    private bleDevice: IBLEDevice,
    private handles: ECBHandles
  ) {
    super();

    // Subscribe to motor position notifications.
    // These subscriptions also keep the BLE connection alive.
    void bleDevice.subscribeToCharacteristic(handles.headNotify, (data) => {
      this.emit('headNotify', data);
    });
    void bleDevice.subscribeToCharacteristic(handles.footNotify, (data) => {
      this.emit('footNotify', data);
    });
  }

  private writeToHandle = async (handle: number, value: number): Promise<void> => {
    try {
      await this.bleDevice.connect();
      await this.bleDevice.writeCharacteristic(handle, new Uint8Array([value]));
    } catch (e) {
      logError('[Reverie ECB] Failed to write characteristic', e);
    }
  };

  writeHead  = (position: number) => this.writeToHandle(this.handles.headWrite, position);
  writeFoot  = (position: number) => this.writeToHandle(this.handles.footWrite, position);
  writeLight = (value: number)    => this.writeToHandle(this.handles.light, value);

  // Override EventEmitter.on to match the IEventSource interface expected by setup functions
  on = (eventName: string, handler: (data: Uint8Array) => void): this => {
    this.addListener(eventName, handler);
    return this;
  };
}
