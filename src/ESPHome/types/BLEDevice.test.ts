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
      { uuid: 'service', handle: 1, characteristicsList: [{ uuid: 'char', handle: 42, properties: 0x02, descriptorsList: [] }] },
    ],
  });
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
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledWith(advertisement.address, advertisement.addressType);
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

  it('backs off exponentially while repeated reconnect attempts keep failing', async () => {
    const connection = buildConnection();
    const device = new BLEDevice('Test', advertisement, connection);
    await device.connect();
    connection.connectBluetoothDeviceService.mockClear();

    connection.connectBluetoothDeviceService.mockRejectedValue(new Error('proxy unreachable'));
    emitConnectionResponse(connection, false);

    await advanceTimersByTimeAsync(5_000); // 1st attempt (initial backoff), fails
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(1);

    await advanceTimersByTimeAsync(10_000); // 2nd attempt (backoff doubled to 10s), fails
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(2);

    connection.connectBluetoothDeviceService.mockResolvedValue({
      address: advertisement.address,
      connected: true,
      mtu: 0,
      error: 0,
    });
    await advanceTimersByTimeAsync(20_000); // 3rd attempt (backoff doubled to 20s), succeeds
    expect(connection.connectBluetoothDeviceService).toHaveBeenCalledTimes(3);
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
});
