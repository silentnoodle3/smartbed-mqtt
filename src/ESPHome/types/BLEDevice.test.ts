import { Connection } from '@2colors/esphome-native-api';
import EventEmitter from 'events';
import { BLEAdvertisement } from './BLEAdvertisement';
import { BLEDevice } from './BLEDevice';

const advertisement: BLEAdvertisement = {
  name: 'Test',
  address: 1234,
  rssi: -50,
  manufacturerDataList: [],
  serviceDataList: [],
  serviceUuidsList: [],
  addressType: 0,
};

// The installed @types/jest is older than the installed jest runtime and doesn't declare this
// (runtime-only) helper for advancing fake timers while also letting pending promises settle in
// between - which every scenario here needs, since a timer callback awaits several network calls
// before possibly scheduling the next timer.
const advanceTimersByTimeAsync = (ms: number) =>
  (jest as unknown as { advanceTimersByTimeAsync(ms: number): Promise<void> }).advanceTimersByTimeAsync(ms);

// A minimal stand-in for esphome-native-api's Connection: a real EventEmitter (so the
// BluetoothDeviceConnectionResponse broadcast behaves the same way it does for every other
// listener) with jest.fn()s for just the GATT/BLE methods BLEDevice actually calls.
const buildConnection = () => {
  const connection = new EventEmitter() as unknown as jest.Mocked<Connection> & EventEmitter;
  connection.connectBluetoothDeviceService = jest
    .fn()
    .mockResolvedValue({ address: advertisement.address, connected: true, mtu: 0, error: 0 });
  connection.disconnectBluetoothDeviceService = jest
    .fn()
    .mockResolvedValue({ address: advertisement.address, connected: false, mtu: 0, error: 0 });
  connection.pairBluetoothDeviceService = jest.fn().mockResolvedValue({ address: advertisement.address, paired: true, error: 0 });
  connection.listBluetoothGATTServicesService = jest.fn().mockResolvedValue({
    address: advertisement.address,
    servicesList: [
      {
        uuid: 'service',
        handle: 1,
        characteristicsList: [
          {
            uuid: 'char',
            handle: 42,
            properties: 0x02,
            descriptorsList: [{ uuid: '00002902-0000-1000-8000-00805f9b34fb', handle: 43 }],
          },
        ],
      },
    ],
  });
  connection.writeBluetoothGATTDescriptorService = jest.fn().mockResolvedValue(undefined);
  connection.readBluetoothGATTCharacteristicService = jest
    .fn()
    .mockResolvedValue({ address: advertisement.address, handle: 42, data: '' });
  connection.writeBluetoothGATTCharacteristicService = jest.fn().mockResolvedValue({ address: advertisement.address, handle: 42 });
  connection.notifyBluetoothGATTCharacteristicService = jest
    .fn()
    .mockResolvedValue({ address: advertisement.address, handle: 42 });
  return connection;
};

const emitConnectionResponse = (connection: EventEmitter, connected: boolean) =>
  connection.emit('message.BluetoothDeviceConnectionResponse', {
    address: advertisement.address,
    connected,
    mtu: 0,
    error: 0,
  });

describe(BLEDevice.name, () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports connected after connect() succeeds', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);

    await device.connect();

    expect(device.isConnected()).toBe(true);
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledWith(advertisement.address, advertisement.addressType, false);
  });

  it('does not re-issue a connect request when already connected', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();
    connection.connectBluetoothDeviceService.mockClear();

    // Callers connect() defensively before every command; that must not cost a round trip (or a
    // full timeout, if the proxy doesn't answer a connect for an already-connected address).
    await device.connect();
    await device.connect();

    expect(connection.connectBluetoothDeviceService).not.toHaveBeenCalled();
    expect(device.isConnected()).toBe(true);
  });

  it('connects again after a drop, even though it skips redundant connects while up', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();
    emitConnectionResponse(connection, false);
    connection.connectBluetoothDeviceService.mockClear();

    await device.connect();

    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(1);
    expect(device.isConnected()).toBe(true);
  });

  it('retries a transient failure on the very first connect() instead of throwing immediately', async () => {
    const connection = buildConnection();
    connection.connectBluetoothDeviceService
      .mockRejectedValueOnce(new Error('sendMessage timeout waiting for BluetoothDeviceConnectionResponse'))
      .mockResolvedValueOnce({ address: advertisement.address, connected: true, mtu: 0, error: 0 });
    const device = new BLEDevice('Test', advertisement, connection);

    const connectPromise = device.connect();
    await advanceTimersByTimeAsync(3_000); // the in-attempt retry delay

    await connectPromise;
    expect(device.isConnected()).toBe(true);
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(2);
  });

  it('gives up after exhausting its retries on the very first connect(), without hanging forever', async () => {
    const connection = buildConnection();
    connection.connectBluetoothDeviceService.mockRejectedValue(new Error('sendMessage timeout waiting for BluetoothDeviceConnectionResponse'));
    const device = new BLEDevice('Test', advertisement, connection);

    const connectPromise = device.connect();
    const assertion = expect(connectPromise).rejects.toThrow('sendMessage timeout');
    await advanceTimersByTimeAsync(3_000 + 3_000);
    await assertion;

    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(3);
    expect(device.isConnected()).toBe(false);
  });

  it('does not re-enter connect() when the proxy echoes back our own connect() response', async () => {
    const connection = buildConnection();
    // Mirrors real esphome-native-api behaviour: the response to our request is also broadcast to
    // any other persistent listener (like the one BLEDevice registers in its constructor).
    connection.connectBluetoothDeviceService = jest.fn().mockImplementation(async () => {
      const response = { address: advertisement.address, connected: true, mtu: 0, error: 0 };
      connection.emit('message.BluetoothDeviceConnectionResponse', response);
      return response;
    });
    const device = new BLEDevice('Test', advertisement, connection);

    await device.connect();

    expect(device.isConnected()).toBe(true);
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(1);
  });

  it('treats an unsolicited disconnect notification as a real drop and reconnects automatically', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();

    const onChange = jest.fn();
    device.onConnectionChange(onChange);

    emitConnectionResponse(connection, false);

    expect(device.isConnected()).toBe(false);
    expect(onChange).toHaveBeenCalledWith(false);

    connection.connectBluetoothDeviceService.mockClear();
    await advanceTimersByTimeAsync(5_000); // initial reconnect backoff

    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(1);
    expect(device.isConnected()).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not react to a disconnect response caused by our own disconnect() call', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();

    const onChange = jest.fn();
    device.onConnectionChange(onChange);

    await device.disconnect();
    onChange.mockClear();
    connection.connectBluetoothDeviceService.mockClear();

    // the proxy's own confirmation of the disconnect we asked for
    emitConnectionResponse(connection, false);

    await advanceTimersByTimeAsync(60_000);
    expect(onChange).not.toHaveBeenCalled();
    expect(connection.connectBluetoothDeviceService).not.toHaveBeenCalled();
  });

  it('retries a bounded number of times within a single attempt before backing off for the next one', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();
    connection.connectBluetoothDeviceService.mockClear();

    connection.connectBluetoothDeviceService.mockRejectedValue(new Error('proxy unreachable'));
    emitConnectionResponse(connection, false);

    // 1st reconnect attempt fires after the initial 5s backoff, then retries internally (3 tries,
    // 3s apart) before finally giving up on this attempt and scheduling the next one.
    await advanceTimersByTimeAsync(5_000 + 3_000 + 3_000);
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(3);
    expect(device.isConnected()).toBe(false);

    connection.connectBluetoothDeviceService.mockClear();
    connection.connectBluetoothDeviceService.mockResolvedValue({
      address: advertisement.address,
      connected: true,
      mtu: 0,
      error: 0,
    });

    // 2nd reconnect attempt fires after the doubled 10s backoff and succeeds on its first try.
    await advanceTimersByTimeAsync(10_000);
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(1);
    expect(device.isConnected()).toBe(true);
  });

  it('treats a failed periodic health check as a stale connection and reconnects', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();

    device.startHealthMonitoring(60_000);
    connection.readBluetoothGATTCharacteristicService.mockRejectedValueOnce(new Error('no response'));

    await advanceTimersByTimeAsync(60_000);

    expect(connection.readBluetoothGATTCharacteristicService).toHaveBeenCalled();
    expect(connection.disconnectBluetoothDeviceService).toHaveBeenCalled();
    expect(device.isConnected()).toBe(false);

    connection.connectBluetoothDeviceService.mockClear();
    await advanceTimersByTimeAsync(5_000); // backed-off reconnect after the stale check
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(1);
    expect(device.isConnected()).toBe(true);
  });

  it('writes the CCCD descriptor when subscribing, so the device actually sends notifications', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();

    await device.subscribeToCharacteristic(42, () => {});

    expect(connection.notifyBluetoothGATTCharacteristicService).toHaveBeenCalledWith(advertisement.address, 42);
    expect(connection.writeBluetoothGATTDescriptorService).toHaveBeenCalledWith(
      advertisement.address,
      43,
      new Uint8Array([0x01, 0x00])
    );
  });

  it('re-enables notifications on the device after an unsolicited drop and reconnect', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();
    await device.subscribeToCharacteristic(42, () => {});
    connection.notifyBluetoothGATTCharacteristicService.mockClear();
    connection.writeBluetoothGATTDescriptorService.mockClear();

    // Notification state is per-connection: the proxy's registration dies with the old GATT
    // connection and the peripheral resets its CCCD, so a reconnect must redo both or live
    // feedback silently stops while writes keep working.
    emitConnectionResponse(connection, false);
    await advanceTimersByTimeAsync(5_000);

    expect(device.isConnected()).toBe(true);
    expect(connection.notifyBluetoothGATTCharacteristicService).toHaveBeenCalledWith(advertisement.address, 42);
    expect(connection.writeBluetoothGATTDescriptorService).toHaveBeenCalledWith(
      advertisement.address,
      43,
      new Uint8Array([0x01, 0x00])
    );
  });

  it('subscribes without throwing when the characteristic has no CCCD descriptor', async () => {
    const connection = buildConnection();
    connection.listBluetoothGATTServicesService = jest.fn().mockResolvedValue({
      address: advertisement.address,
      servicesList: [
        { uuid: 'service', handle: 1, characteristicsList: [{ uuid: 'char', handle: 42, properties: 0x02, descriptorsList: [] }] },
      ],
    });
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();

    await expect(device.subscribeToCharacteristic(42, () => {})).resolves.not.toThrow();
    expect(connection.writeBluetoothGATTDescriptorService).not.toHaveBeenCalled();
  });

  it('does not run health checks while disconnected, and resumes once reconnected', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();
    device.startHealthMonitoring(60_000);

    await device.disconnect();
    connection.readBluetoothGATTCharacteristicService.mockClear();

    await advanceTimersByTimeAsync(60_000);
    expect(connection.readBluetoothGATTCharacteristicService).not.toHaveBeenCalled();
  });

  it('retries promptly once the proxy link is re-established, instead of waiting out the built-up backoff', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();

    // proxy unplugged: the link drops and every reconnect attempt fails until the backoff maxes out
    connection.connectBluetoothDeviceService.mockRejectedValue(new Error('proxy unreachable'));
    connection.emit('disconnected');
    await advanceTimersByTimeAsync(30 * 60_000);
    expect(device.isConnected()).toBe(false);

    // proxy back: the library re-authorizes the link, and the next attempt should come quickly
    connection.connectBluetoothDeviceService.mockClear();
    connection.connectBluetoothDeviceService.mockResolvedValue({
      address: advertisement.address,
      connected: true,
      mtu: 0,
      error: 0,
    });
    connection.emit('authorized');

    await advanceTimersByTimeAsync(5_000);
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(1);
    expect(device.isConnected()).toBe(true);
  });

  it('ignores the proxy link being re-authorized while the device is still connected', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();
    connection.connectBluetoothDeviceService.mockClear();

    connection.emit('authorized');
    await advanceTimersByTimeAsync(60_000);

    expect(connection.connectBluetoothDeviceService).not.toHaveBeenCalled();
  });
});
