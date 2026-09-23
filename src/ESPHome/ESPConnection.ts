import { Connection } from '@2colors/esphome-native-api';
import { Deferred } from '@utils/deferred';
import { logInfo, logWarn } from '@utils/logger';
import { IESPConnection } from './IESPConnection';
import { connect } from './connect';
import { BLEAdvertisement } from './types/BLEAdvertisement';
import { BLEDevice } from './types/BLEDevice';
import { IBLEDevice } from './types/IBLEDevice';

export class ESPConnection implements IESPConnection {
  constructor(private connections: Connection[]) {
    connections.forEach(this.keepBluetoothSubscription);
  }

  async reconnect(): Promise<void> {
    this.disconnect();
    logInfo('[ESPHome] Reconnecting...');
    this.connections = await Promise.all(
      this.connections.map((connection) =>
        connect(new Connection({ host: connection.host, port: connection.port, password: connection.password }))
      )
    );
    this.connections.forEach(this.keepBluetoothSubscription);
  }

  // esphome-native-api transparently re-establishes the proxy's TCP link after it drops (e.g. the
  // ESP32 being unplugged or rebooting), but that's a brand new API session on the proxy side, with
  // none of the old one's state. In particular the advertisement subscription - which is what makes
  // this client the proxy's Bluetooth subscriber (see discoverBLEDevices) - is gone, and without it
  // the proxy never answers a BLE connect request, so every reconnect attempt just times out forever
  // until the add-on is restarted. Re-subscribe whenever the link is re-authorized.
  private keepBluetoothSubscription = (connection: Connection) => {
    connection.on('authorized', () => {
      logInfo('[ESPHome] Proxy connection re-established, re-subscribing to Bluetooth:', connection.host);
      try {
        connection.subscribeBluetoothAdvertisementService();
      } catch (e) {
        logWarn('[ESPHome] Failed to re-subscribe to Bluetooth after proxy reconnect:', connection.host, e);
      }
    });
  };

  disconnect(): void {
    logInfo('[ESPHome] Disconnecting...');

    for (const connection of this.connections) {
      connection.disconnect();
      connection.connected = false;
    }
  }

  async getBLEDevices(deviceNames: string[], nameMapper?: (name: string) => string): Promise<IBLEDevice[]> {
    logInfo(`[ESPHome] Searching for device(s): ${deviceNames.join(', ')}`);
    deviceNames = deviceNames.map((name) => name.toLowerCase());
    const bleDevices: IBLEDevice[] = [];
    const complete = new Deferred<void>();
    await this.discoverBLEDevices(
      (bleDevice) => {
        const { name, mac } = bleDevice;
        let index = deviceNames.indexOf(mac);
        if (index === -1) index = deviceNames.indexOf(name.toLowerCase());
        if (index === -1) return;

        deviceNames.splice(index, 1);
        logInfo(`[ESPHome] Found device: ${name} (${mac})`);
        bleDevices.push(bleDevice);
        if (deviceNames.length) return;
        complete.resolve();
      },
      complete,
      nameMapper
    );
    if (deviceNames.length) logWarn(`[ESPHome] Cound not find address for device(s): ${deviceNames.join(', ')}`);
    return bleDevices;
  }

  async discoverBLEDevices(
    onNewDeviceFound: (bleDevice: IBLEDevice) => void,
    complete: Promise<void>,
    nameMapper?: (name: string) => string
  ) {
    const seenAddresses: number[] = [];
    const listenerBuilder = (connection: Connection) => ({
      connection,
      listener: (advertisement: BLEAdvertisement) => {
        let { name } = advertisement;
        const { address } = advertisement;

        if (seenAddresses.includes(address) || !name) return;
        seenAddresses.push(address);

        if (nameMapper) name = nameMapper(name);
        onNewDeviceFound(new BLEDevice(name, advertisement, connection));
      },
    });
    const listeners = this.connections.map(listenerBuilder);
    for (const { connection, listener } of listeners) {
      connection.on('message.BluetoothLEAdvertisementResponse', listener).subscribeBluetoothAdvertisementService();
    }
    await complete;
    for (const { connection, listener } of listeners) {
      connection.off('message.BluetoothLEAdvertisementResponse', listener);
      // NOTE: do NOT call unsubscribeBluetoothAdvertisementService() here. v1.1.22-reverie.14 did,
      // on the assumption the advertisement stream was just wasted traffic once the one-time device
      // scan above finished. It isn't: in ESPHome's bluetooth_proxy, that subscription is what
      // registers this API client as the proxy's Bluetooth subscriber. Unsubscribing tells the
      // proxy this client is done with Bluetooth entirely, so it tears down that client's BLE
      // connections - including ones still being established - which made every subsequent
      // connect() hang until its timeout, deterministically, on every single attempt.
      // Dropping our own listener (above) is enough to stop processing advertisements we no longer
      // care about; the proxy-side subscription has to stay for the lifetime of the connection.
    }
  }
}
