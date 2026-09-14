import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { IBLEDevice } from 'ESPHome/types/IBLEDevice';
import { mock } from 'jest-mock-extended';
import { testDevice } from '@utils/testHelpers';
import { setupConnectionAvailability } from './setupConnectionAvailability';

describe(setupConnectionAvailability.name, () => {
  it('does nothing when the device has no availability topic', () => {
    const mqtt = mock<IMQTTConnection>();
    const bleDevice = mock<IBLEDevice>();
    const deviceData = { ...testDevice, availabilityTopic: undefined };

    setupConnectionAvailability(mqtt, bleDevice, deviceData);

    expect(mqtt.publish).not.toHaveBeenCalled();
    expect(bleDevice.onConnectionChange).not.toHaveBeenCalled();
    expect(bleDevice.startHealthMonitoring).not.toHaveBeenCalled();
  });

  it('publishes the current state immediately, retained, and starts health monitoring', () => {
    const mqtt = mock<IMQTTConnection>();
    const bleDevice = mock<IBLEDevice>();
    bleDevice.isConnected.mockReturnValue(true);
    const deviceData = { ...testDevice, availabilityTopic: 'device_topic/bleConnection/status' };

    setupConnectionAvailability(mqtt, bleDevice, deviceData);

    expect(mqtt.publish).toHaveBeenCalledWith('device_topic/bleConnection/status', 'online', true);
    expect(bleDevice.startHealthMonitoring).toHaveBeenCalled();
  });

  it('republishes offline/online as the BLE connection state changes', () => {
    const mqtt = mock<IMQTTConnection>();
    const bleDevice = mock<IBLEDevice>();
    bleDevice.isConnected.mockReturnValue(true);
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
});
