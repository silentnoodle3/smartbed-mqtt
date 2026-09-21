import { BluetoothGATTService, Connection } from '@2colors/esphome-native-api';
import { Dictionary } from '@utils/Dictionary';
import { BLEAdvertisement } from './BLEAdvertisement';
import { BLEDeviceInfo } from './BLEDeviceInfo';
import { IBLEDevice } from './IBLEDevice';
import { logError, logInfo, logWarn } from '@utils/logger';
import { minutes } from '@utils/minutes';
import { seconds } from '@utils/seconds';
import { wait } from '@utils/wait';
import { withTimeout } from '@utils/withTimeout';
import EventEmitter from 'events';

// BLE GATT characteristic "Read" property bit (Bluetooth Core Spec, Characteristic Properties).
const READABLE_PROPERTY = 0x02;

const HEALTH_CHECK_TIMEOUT = seconds(10);
const DEFAULT_HEALTH_CHECK_INTERVAL = minutes(3);
const INITIAL_RECONNECT_BACKOFF = seconds(5);
const MAX_RECONNECT_BACKOFF = minutes(5);
// A single connect() attempt can transiently time out - e.g. the proxy briefly still holding a
// session for this address from a connection it thinks is still open (such as right after this
// add-on itself restarts without ever cleanly disconnecting). A few quick retries absorb that
// without surfacing a failure to the caller at all; genuine unreachability still eventually
// surfaces so callers can react (index.ts won't hang forever waiting on a truly absent device).
const CONNECT_ATTEMPTS = 3;
const CONNECT_RETRY_DELAY = seconds(3);

export class BLEDevice implements IBLEDevice {
  private connected = false;
  private paired = false;
  // True while a connect()/disconnect() call we made ourselves is in flight, so the
  // BluetoothDeviceConnectionResponse it provokes isn't mistaken for an unsolicited
  // notification from the proxy (see the constructor listener below).
  private transitioning = false;

  private servicesList?: BluetoothGATTService[];
  private serviceCache: Dictionary<BluetoothGATTService | null> = {};

  private deviceInfo?: BLEDeviceInfo;

  private connectionEmitter = new EventEmitter();
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectBackoff = INITIAL_RECONNECT_BACKOFF;

  private healthCheckTimer?: NodeJS.Timeout;
  private healthCheckIntervalMs?: number;
  // undefined = not looked up yet, null = looked up and none found.
  private healthCheckHandle?: number | null;

  public mac: string;
  public get address() {
    return this.advertisement.address;
  }
  public get manufacturerDataList() {
    return this.advertisement.manufacturerDataList;
  }
  public get serviceUuidsList() {
    return this.advertisement.serviceUuidsList;
  }

  constructor(public name: string, public advertisement: BLEAdvertisement, private connection: Connection) {
    this.mac = this.address.toString(16).padStart(12, '0');
    // The ESP32 proxy broadcasts this message both as the direct response to a connect()/
    // disconnect() request we made and, separately, whenever the bed's BLE link changes state on
    // its own (a real disconnect, or the bed/proxy re-establishing it). Ignore the former (our own
    // connect()/disconnect() already update `connected` themselves) and only react to the latter -
    // an unsolicited state change we didn't ask for - by treating a drop as a real disconnect and
    // kicking off an automatic reconnect.
    this.connection.on('message.BluetoothDeviceConnectionResponse', ({ address, connected }) => {
      if (this.address !== address || this.transitioning || this.connected === connected) return;
      this.updateConnectedState(connected, 'unsolicited notification from proxy');
    });

    // The proxy's own TCP link (separate from the BLE link it's brokering) can also drop -
    // e.g. the ESP32 rebooting or losing Wi-Fi - taking any BLE session it was holding with it.
    // esphome-native-api reconnects the TCP link itself, but our BLE session doesn't come back
    // for free, so treat this the same as a real BLE disconnect and let the usual backed-off
    // reconnect loop pick it back up once the proxy is reachable again.
    this.connection.on('disconnected', () => {
      if (this.connected) this.updateConnectedState(false, 'ESPHome proxy connection lost');
    });
    this.connection.on('error', (error: unknown) => {
      logError(`[BLE] ESPHome proxy connection error for ${this.name}:`, error);
    });
  }

  private updateConnectedState = (connected: boolean, reason: string) => {
    if (this.connected === connected) return;
    this.connected = connected;
    if (connected) {
      logInfo(`[BLE] Connected (${reason}):`, this.name);
      this.reconnectBackoff = INITIAL_RECONNECT_BACKOFF;
    } else {
      logWarn(`[BLE] Disconnected (${reason}):`, this.name);
    }
    this.connectionEmitter.emit('connectionChange', connected);
    if (!connected) this.scheduleReconnect();
  };

  private scheduleReconnect = () => {
    if (this.reconnectTimer) return;
    const delay = this.reconnectBackoff;
    logInfo(`[BLE] Will attempt to reconnect to ${this.name} in ${Math.round(delay / 1000)}s`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.connect();
        logInfo('[BLE] Reconnected:', this.name);
      } catch (e) {
        logError(`[BLE] Reconnect attempt failed for ${this.name}, will retry:`, e);
        this.reconnectBackoff = Math.min(this.reconnectBackoff * 2, MAX_RECONNECT_BACKOFF);
        this.scheduleReconnect();
      }
    }, delay);
  };

  isConnected = () => this.connected;

  onConnectionChange = (handler: (connected: boolean) => void) => {
    this.connectionEmitter.on('connectionChange', handler);
  };

  startHealthMonitoring = (intervalMs: number = DEFAULT_HEALTH_CHECK_INTERVAL) => {
    this.healthCheckIntervalMs = intervalMs;
    this.scheduleHealthCheck();
  };

  private scheduleHealthCheck = () => {
    if (!this.healthCheckIntervalMs) return;
    clearTimeout(this.healthCheckTimer);
    this.healthCheckTimer = setTimeout(this.runHealthCheck, this.healthCheckIntervalMs);
  };

  private runHealthCheck = async () => {
    if (!this.healthCheckIntervalMs) return;
    if (!this.connected) return void this.scheduleHealthCheck();

    try {
      await this.probeConnection();
    } catch (e) {
      logWarn(`[BLE] Health check failed for ${this.name}, treating connection as stale:`, e);
      await this.forceReconnect();
    }
    this.scheduleHealthCheck();
  };

  private probeConnection = async () => {
    if (this.healthCheckHandle === undefined) {
      this.healthCheckHandle = (await this.findHealthCheckHandle()) ?? null;
    }
    if (this.healthCheckHandle === null) return; // nothing safe to probe with - skip rather than false-positive

    await withTimeout(this.readCharacteristic(this.healthCheckHandle), HEALTH_CHECK_TIMEOUT, `${this.name} health check`);
  };

  private findHealthCheckHandle = async (): Promise<number | undefined> => {
    try {
      const services = await this.getServices();
      for (const service of services) {
        const characteristic = service.characteristicsList?.find((c) => (c.properties & READABLE_PROPERTY) !== 0);
        if (characteristic) return characteristic.handle;
      }
    } catch (e) {
      logWarn(`[BLE] Could not find a characteristic to health-check for ${this.name}:`, e);
    }
    return undefined;
  };

  private forceReconnect = async () => {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    try {
      await this.connection.disconnectBluetoothDeviceService(this.address);
    } catch {
      // best-effort - the link may already be gone, which is exactly why we're here
    }
    // Transitions connected -> false, which itself schedules the backed-off reconnect attempt.
    this.updateConnectedState(false, 'stale health check');
  };

  pair = async () => {
    const { paired } = await this.connection.pairBluetoothDeviceService(this.address);
    this.paired = paired;
  };

  connect = async () => {
    this.transitioning = true;
    try {
      await this.connectWithRetry();
      this.updateConnectedState(true, 'connect() succeeded');
      if (this.paired) await this.pair();
    } finally {
      this.transitioning = false;
    }
  };

  private connectWithRetry = async (attempt: number = 1): Promise<void> => {
    const { addressType } = this.advertisement;
    try {
      // The library's default (useCache: false, i.e. "connect v3 without cache") makes the proxy
      // run a full fresh GATT service discovery as part of connecting, before it's even allowed to
      // reply that it's connected. For a device with a lot of characteristics on one service (like
      // this one), that discovery can apparently take longer than the client's fixed wait for a
      // response - producing a connect that hangs/times out every single time, deterministically,
      // regardless of proxy reboots or anything else client-side. Requesting the cached variant
      // skips that re-discovery.
      await this.connection.connectBluetoothDeviceService(this.address, addressType, true);
    } catch (e) {
      if (attempt >= CONNECT_ATTEMPTS) throw e;
      logWarn(`[BLE] Connect attempt ${attempt}/${CONNECT_ATTEMPTS} failed for ${this.name}, retrying:`, e);
      await wait(CONNECT_RETRY_DELAY);
      await this.connectWithRetry(attempt + 1);
    }
  };

  disconnect = async () => {
    this.transitioning = true;
    try {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      await this.connection.disconnectBluetoothDeviceService(this.address);
    } finally {
      this.connected = false;
      this.transitioning = false;
    }
  };

  writeCharacteristic = async (handle: number, bytes: Uint8Array, response = true) => {
    await this.connection.writeBluetoothGATTCharacteristicService(this.address, handle, bytes, response);
  };

  getServices = async () => {
    if (!this.servicesList) {
      const { servicesList } = await this.connection.listBluetoothGATTServicesService(this.address);
      this.servicesList = servicesList;
    }
    return this.servicesList;
  };

  getCharacteristic = async (serviceUuid: string, characteristicUuid: string, writeLogs = true) => {
    const service = await this.getService(serviceUuid);

    if (!service) {
      writeLogs && logInfo('[BLE] Could not find expected service for device:', serviceUuid, this.name);
      return undefined;
    }

    const characteristic = service?.characteristicsList?.find((c) => c.uuid === characteristicUuid);
    if (!characteristic) {
      writeLogs && logInfo('[BLE] Could not find expected characteristic for device:', characteristicUuid, this.name);
      return undefined;
    }

    return characteristic;
  };

  subscribeToCharacteristic = async (handle: number, notify: (data: Uint8Array) => void) => {
    this.connection.on('message.BluetoothGATTNotifyDataResponse', (message) => {
      if (message.address != this.address || message.handle != handle) return;
      notify(new Uint8Array([...Buffer.from(message.data, 'base64')]));
    });
    await this.connection.notifyBluetoothGATTCharacteristicService(this.address, handle);
  };

  readCharacteristic = async (handle: number) => {
    const response = await this.connection.readBluetoothGATTCharacteristicService(this.address, handle);
    return new Uint8Array([...Buffer.from(response.data, 'base64')]);
  };

  getDeviceInfo = async () => {
    if (this.deviceInfo) return this.deviceInfo;
    const services = await this.getServices();
    const service = services.find((s) => s.uuid === '0000180a-0000-1000-8000-00805f9b34fb');
    if (!service) return undefined;

    const deviceInfo: BLEDeviceInfo = (this.deviceInfo = {});
    const setters: Dictionary<(value: string) => void> = {
      '00002a24-0000-1000-8000-00805f9b34fb': (value: string) => (deviceInfo.modelNumber = value),
      '00002a25-0000-1000-8000-00805f9b34fb': (value: string) => (deviceInfo.serialNumber = value),
      '00002a26-0000-1000-8000-00805f9b34fb': (value: string) => (deviceInfo.firmwareRevision = value),
      '00002a27-0000-1000-8000-00805f9b34fb': (value: string) => (deviceInfo.hardwareRevision = value),
      '00002a28-0000-1000-8000-00805f9b34fb': (value: string) => (deviceInfo.softwareRevision = value),
      '00002a29-0000-1000-8000-00805f9b34fb': (value: string) => (deviceInfo.manufacturerName = value),
    };
    for (const { uuid, handle } of service.characteristicsList) {
      const setter = setters[uuid];
      if (!setter) continue;
      try {
        const value = await this.readCharacteristic(handle);
        setter(Buffer.from(value).toString());
      } catch {}
    }

    return this.deviceInfo;
  };

  private getService = async (serviceUuid: string) => {
    const cachedService = this.serviceCache[serviceUuid];
    if (cachedService !== undefined) return cachedService;

    const services = await this.getServices();
    const service = services.find((s) => s.uuid === serviceUuid) || null;
    this.serviceCache[serviceUuid] = service;
    return service;
  };
}
