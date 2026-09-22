import { BluetoothGATTCharacteristic, BluetoothGATTService } from '@2colors/esphome-native-api';
import { BLEAdvertisement } from './BLEAdvertisement';
import { BLEDeviceInfo } from './BLEDeviceInfo';

export interface IBLEDevice {
  name: string;
  mac: string;
  address: number;
  advertisement: BLEAdvertisement;
  pair(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  writeCharacteristic(handle: number, bytes: Uint8Array, response?: boolean): Promise<void>;
  getCharacteristic(
    serviceUuid: string,
    characteristicUuid: string,
    writeLogs?: boolean
  ): Promise<BluetoothGATTCharacteristic | undefined>;
  getServices(): Promise<BluetoothGATTService[]>;
  subscribeToCharacteristic(handle: number, notify: (data: Uint8Array) => void): Promise<void>;
  readCharacteristic(handle: number): Promise<Uint8Array>;
  getDeviceInfo(): Promise<BLEDeviceInfo | undefined>;

  // Real-time BLE link health, independent of whatever the proxy's MQTT/TCP connection is doing.
  isConnected(): boolean;
  // Fires whenever the BLE link to this device actually goes up/down - including a silent drop
  // detected by the proxy or by the periodic health check below, not just an intentional
  // connect()/disconnect() call.
  onConnectionChange(handler: (connected: boolean) => void): void;
  // Starts a periodic cheap read against a known characteristic to catch a connection that has
  // gone stale without ever firing a disconnect event (the ESP32 proxy or the bed can drop the
  // link silently). A failed/timed-out check tears down and re-establishes the connection,
  // backing off between repeated failures instead of hammering the proxy. Intended only for
  // devices that are meant to stay connected persistently - see IController.isPersistentConnection.
  startHealthMonitoring(intervalMs?: number): void;
  // Connection history for this link, for diagnostics - see BLE/setupConnectionAvailability.
  getConnectionStats(): BLEConnectionStats;
  // Re-registers notifications and re-writes their CCCD for every characteristic subscribed to via
  // subscribeToCharacteristic. Done automatically after a reconnect; exposed so a caller that knows
  // notifications *should* be arriving (e.g. it just moved the bed) can recover if they aren't.
  refreshNotifySubscriptions(): Promise<void>;
}

export type BLEConnectionStats = {
  connected: boolean;
  connectedSince?: Date;
  lastDisconnectAt?: Date;
  disconnectCount: number;
};
