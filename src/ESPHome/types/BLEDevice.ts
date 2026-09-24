import { BluetoothGATTService, Connection } from '@2colors/esphome-native-api';
import { Dictionary } from '@utils/Dictionary';
import { BLEAdvertisement } from './BLEAdvertisement';
import { BLEDeviceInfo } from './BLEDeviceInfo';
import { BLEConnectionStats, IBLEDevice } from './IBLEDevice';
import { logError, logInfo, logWarn } from '@utils/logger';
import { minutes } from '@utils/minutes';
import { seconds } from '@utils/seconds';
import { wait } from '@utils/wait';
import { withTimeout } from '@utils/withTimeout';
import EventEmitter from 'events';

// BLE GATT characteristic "Read" property bit (Bluetooth Core Spec, Characteristic Properties).
const READABLE_PROPERTY = 0x02;

// Client Characteristic Configuration Descriptor - the standard descriptor a central writes to to
// tell a peripheral to start sending notifications on a characteristic. 0x0001 = notifications on.
const CCCD_UUID = '00002902-0000-1000-8000-00805f9b34fb';
const ENABLE_NOTIFICATIONS = new Uint8Array([0x01, 0x00]);

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

  // Characteristic handles we've been asked to receive notifications on, so they can be re-enabled
  // on the device after a reconnect (see restoreNotifySubscriptions).
  private notifyHandles: number[] = [];

  private disconnectCount = 0;
  private connectedSince?: Date;
  private lastDisconnectAt?: Date;

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
    // Once the proxy is reachable again, don't sit out whatever backoff the failed attempts while it
    // was down built up (up to MAX_RECONNECT_BACKOFF) - try again promptly. ESPConnection registers
    // its own 'authorized' listener before any BLEDevice exists, so the proxy has already been asked
    // to re-subscribe us to Bluetooth by the time this runs.
    this.connection.on('authorized', () => {
      if (this.connected) return;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this.reconnectBackoff = INITIAL_RECONNECT_BACKOFF;
      this.scheduleReconnect();
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
      this.connectedSince = new Date();
    } else {
      logWarn(`[BLE] Disconnected (${reason}):`, this.name);
      this.disconnectCount++;
      this.lastDisconnectAt = new Date();
      this.connectedSince = undefined;
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

  getConnectionStats = (): BLEConnectionStats => ({
    connected: this.connected,
    connectedSince: this.connectedSince,
    lastDisconnectAt: this.lastDisconnectAt,
    disconnectCount: this.disconnectCount,
  });

  refreshNotifySubscriptions = async () => {
    if (!this.connected) return;
    await this.restoreNotifySubscriptions();
  };

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
    // Callers (e.g. RevCBController/BLEController before every write) call this defensively on
    // every command, since for non-persistent devices the link may have been dropped since the
    // last one. Re-issuing a connect request for a device we're already connected to used to be
    // harmless - the old library sent the now-removed V1 CONNECT type, which the proxy answered
    // immediately. The V3 connect types it sends now aren't necessarily answered for an
    // already-connected address, leaving the caller waiting out the full timeout (and this class's
    // retries) on every single command. Real drops still clear `connected` - via the proxy's
    // unsolicited notification, the proxy connection dying, or the periodic health check - so
    // skipping the redundant round-trip here is safe.
    if (this.connected) return;

    this.transitioning = true;
    try {
      await this.connectWithRetry();
      this.updateConnectedState(true, 'connect() succeeded');
      if (this.paired) await this.pair();
      await this.restoreNotifySubscriptions();
    } finally {
      this.transitioning = false;
    }
  };

  private connectWithRetry = async (attempt: number = 1): Promise<void> => {
    const { addressType } = this.advertisement;
    try {
      // Reverted from useCache: true (v16) - proxy-side debug logs showed it wasn't slow GATT
      // discovery causing the client-side timeout after all: the proxy accepts the connect request
      // and starts connecting, but self-aborts (schedules and runs its own disconnect) after only
      // ~100ms, before a connection ever stabilizes, every single attempt - something neither this
      // add-on nor useCache controls. Back to the library's default (false / "without cache") while
      // that gets diagnosed further with matching proxy-side visibility.
      // esphome-native-api resolves with whatever BluetoothDeviceConnectionResponse arrives - including
      // the proxy reporting that the attempt failed (e.g. the device isn't powered). That's not a
      // connection, and treating it as one would mark the device connected while nothing works.
      const { connected, error } = await this.connection.connectBluetoothDeviceService(this.address, addressType, false);
      if (!connected) throw new Error(`Proxy reported connect failed for ${this.name} (error ${error})`);
    } catch (e) {
      await this.resetProxyConnectionSlot();
      if (attempt >= CONNECT_ATTEMPTS) throw e;
      logWarn(`[BLE] Connect attempt ${attempt}/${CONNECT_ATTEMPTS} failed for ${this.name}, retrying:`, e);
      await wait(CONNECT_RETRY_DELAY);
      await this.connectWithRetry(attempt + 1);
    }
  };

  // The proxy silently ignores a connect request for an address whose connection slot isn't idle -
  // still searching for, waiting to connect to, or connecting to it from an earlier request - with no
  // response at all, so all we ever see is a client-side timeout. If an attempt against an absent
  // device (e.g. the bed unplugged for a while) leaves that slot wedged mid-attempt, every later
  // request is ignored the same way and the link never heals until the proxy itself is power-cycled.
  // A DISCONNECT request is what makes the proxy tear down whatever state that slot is in, so send
  // one after every failed attempt so the next one starts from a clean slot. Best-effort: when the
  // slot is already free the proxy just answers "disconnected", and if it doesn't answer at all
  // there's nothing more useful to do than carry on retrying.
  private resetProxyConnectionSlot = async () => {
    try {
      await this.connection.disconnectBluetoothDeviceService(this.address);
    } catch (e) {
      logWarn(`[BLE] Could not reset the proxy's connection slot for ${this.name}:`, e);
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
    // The local listener is registered once and survives reconnects (it's on the proxy connection,
    // not the BLE link). The device-side enablement below does NOT survive - see
    // restoreNotifySubscriptions - so the handle is remembered to be re-enabled after a reconnect.
    this.connection.on('message.BluetoothGATTNotifyDataResponse', (message) => {
      if (message.address != this.address || message.handle != handle) return;
      notify(new Uint8Array([...Buffer.from(message.data, 'base64')]));
    });
    if (!this.notifyHandles.includes(handle)) this.notifyHandles.push(handle);
    await this.enableNotify(handle);
  };

  private enableNotify = async (handle: number) => {
    await this.connection.notifyBluetoothGATTCharacteristicService(this.address, handle);
    await this.enableNotificationsOnDevice(handle);
  };

  // Notification state is per-connection, not per-device: the proxy's notify registration belongs
  // to the GATT connection that's just been replaced, and for a non-bonded device the peripheral
  // resets its CCCD to 0 on disconnect. So after any reconnect, notifications are off again even
  // though writes work perfectly - which looks exactly like "commands fine, position display dead".
  // Nothing re-subscribed after the automatic reconnect added in v1.1.22-reverie.13, so this could
  // survive one overnight drop and silently lose live feedback until the add-on was restarted.
  private restoreNotifySubscriptions = async () => {
    for (const handle of this.notifyHandles) {
      try {
        await this.enableNotify(handle);
        logInfo(`[BLE] Re-enabled notifications after reconnect for ${this.name}, handle:`, handle);
      } catch (e) {
        logError(`[BLE] Failed to re-enable notifications after reconnect for ${this.name}, handle ${handle}`, e);
      }
    }
  };

  // Registering for notify above only tells the proxy to route this characteristic's notifications
  // to us - it's a local registration, which is why it succeeds even when nothing ever arrives.
  // What actually tells the *peripheral* to start sending them is writing its Client Characteristic
  // Configuration descriptor. Doing that explicitly here rather than relying on the proxy to do it,
  // because the connect type this add-on now has to use ("v3 without cache", the old plain connect
  // having been removed from the protocol) doesn't necessarily give the proxy a descriptor table to
  // find the CCCD in - which produces exactly the "subscribed fine, no data ever" symptom.
  // Writing it twice is harmless if the proxy already did it.
  private enableNotificationsOnDevice = async (characteristicHandle: number) => {
    const descriptorHandle = await this.findCCCDHandle(characteristicHandle);
    if (descriptorHandle === undefined) {
      logWarn(
        `[BLE] No CCCD descriptor found for characteristic ${characteristicHandle} on ${this.name} - the device may never send notifications for it`
      );
      return;
    }
    await this.connection.writeBluetoothGATTDescriptorService(this.address, descriptorHandle, ENABLE_NOTIFICATIONS);
  };

  private findCCCDHandle = async (characteristicHandle: number): Promise<number | undefined> => {
    const services = await this.getServices();
    for (const service of services) {
      const characteristic = service.characteristicsList?.find((c) => c.handle === characteristicHandle);
      if (!characteristic) continue;
      return characteristic.descriptorsList?.find((d) => d.uuid === CCCD_UUID)?.handle;
    }
    return undefined;
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
