import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { IBLEDevice } from 'ESPHome/types/IBLEDevice';
import { mock } from 'jest-mock-extended';
import { testDevice } from '@utils/testHelpers';
import { loadStrings } from '@utils/getString';
import { setupConnectionAvailability } from './setupConnectionAvailability';

const buildBleDevice = (connected: boolean = true, disconnectCount: number = 0) => {
  const bleDevice = mock<IBLEDevice>();
  bleDevice.isConnected.mockReturnValue(connected);
  bleDevice.getConnectionStats.mockReturnValue({ connected, disconnectCount });
  return bleDevice;
};

describe(setupConnectionAvailability.name, () => {
  // Without this, getString() falls back to returning the raw key, which changes the entity
  // descriptions and therefore the topic slugs derived from them - so the diagnostic topics
  // asserted below wouldn't match what actually gets published in production.
  beforeAll(async () => {
    await loadStrings();
    jest.useFakeTimers();
  });

  it('does nothing when the device has no availability topic', () => {
    const mqtt = mock<IMQTTConnection>();
    const bleDevice = buildBleDevice();
    const deviceData = { ...testDevice, availabilityTopic: undefined };

    setupConnectionAvailability(mqtt, bleDevice, deviceData);

    expect(mqtt.publish).not.toHaveBeenCalled();
    expect(bleDevice.onConnectionChange).not.toHaveBeenCalled();
    expect(bleDevice.startHealthMonitoring).not.toHaveBeenCalled();
  });

  it('publishes the current state immediately, retained, and starts health monitoring', () => {
    const mqtt = mock<IMQTTConnection>();
    const bleDevice = buildBleDevice();
    const deviceData = { ...testDevice, availabilityTopic: 'device_topic/bleConnection/status' };

    setupConnectionAvailability(mqtt, bleDevice, deviceData);

    expect(mqtt.publish).toHaveBeenCalledWith('device_topic/bleConnection/status', 'online', true);
    expect(bleDevice.startHealthMonitoring).toHaveBeenCalled();
  });

  it('republishes offline/online as the BLE connection state changes', () => {
    const mqtt = mock<IMQTTConnection>();
    const bleDevice = buildBleDevice();
    let onChange: (connected: boolean) => void = () => {};
    bleDevice.onConnectionChange.mockImplementation((handler) => (onChange = handler));
    const deviceData = { ...testDevice, availabilityTopic: 'device_topic/bleConnection/status' };

    setupConnectionAvailability(mqtt, bleDevice, deviceData);
    mqtt.publish.mockClear();

    onChange(false);
    expect(mqtt.publish).toHaveBeenCalledWith('device_topic/bleConnection/status', 'offline', true);

    onChange(true);
    expect(mqtt.publish).toHaveBeenCalledWith('device_topic/bleConnection/status', 'online', true);
  });

  it('publishes connection diagnostics, and republishes them as the connection changes', () => {
    const mqtt = mock<IMQTTConnection>();
    const connectedSince = new Date('2026-09-22T00:50:13.000Z');
    const lastDisconnectAt = new Date('2026-09-22T02:31:26.000Z');
    const bleDevice = buildBleDevice();
    bleDevice.getConnectionStats.mockReturnValue({ connected: true, connectedSince, lastDisconnectAt, disconnectCount: 3 });
    let onChange: (connected: boolean) => void = () => {};
    bleDevice.onConnectionChange.mockImplementation((handler) => (onChange = handler));
    const deviceData = { ...testDevice, availabilityTopic: 'device_topic/bleConnection/status' };

    setupConnectionAvailability(mqtt, bleDevice, deviceData);
    jest.runAllTimers();

    // Retained: these must survive an HA Core restart between connection-state changes, which may
    // legitimately be a long time (see BLEDevice.ts's comment on buildDiagnosticSensors).
    expect(mqtt.publish).toHaveBeenCalledWith('device_topic/ble_disconnects/state', 3, true);
    expect(mqtt.publish).toHaveBeenCalledWith('device_topic/ble_connected_since/state', connectedSince.toISOString(), true);
    expect(mqtt.publish).toHaveBeenCalledWith('device_topic/ble_last_disconnect/state', lastDisconnectAt.toISOString(), true);

    // A drop should bump the count and clear "connected since" rather than leave a stale value.
    bleDevice.getConnectionStats.mockReturnValue({ connected: false, lastDisconnectAt, disconnectCount: 4 });
    mqtt.publish.mockClear();
    onChange(false);
    jest.runAllTimers();

    expect(mqtt.publish).toHaveBeenCalledWith('device_topic/ble_disconnects/state', 4, true);
    expect(mqtt.publish).toHaveBeenCalledWith('device_topic/ble_connected_since/status', 'offline');
  });
});
