import { IDeviceData } from '@ha/IDeviceData';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { logInfo } from '@utils/logger';
import { IBLEDevice } from 'ESPHome/types/IBLEDevice';

const ONLINE = 'online';
const OFFLINE = 'offline';

// Publishes (and keeps updated) a per-device MQTT availability/heartbeat topic that reflects the
// *real* BLE connection health to the physical bed - not just whether this add-on's MQTT client
// is connected. HA entities gate their own availability on this topic too (see
// HomeAssistant/base/Entity), so a dropped or silently-stale BLE link now correctly shows as
// `unavailable` in HA instead of entities freezing on their last known value. This also gives HA
// something real to key an automation off of (e.g. restart the add-on after N minutes
// unavailable), instead of a blind timer.
//
// Only meaningful for a device that's meant to stay connected persistently - call this once the
// controller reports IController.isPersistentConnection, right after it's built (mirroring where
// BLE/setupDeviceInfoSensor is already called for every bed type).
export const setupConnectionAvailability = (mqtt: IMQTTConnection, bleDevice: IBLEDevice, deviceData: IDeviceData, healthCheckIntervalMs?: number) => {
  const { availabilityTopic } = deviceData;
  if (!availabilityTopic) return;

  const publish = (connected: boolean) => {
    logInfo(`[BLE] BLE connection for ${deviceData.device.name} is now:`, connected ? ONLINE : OFFLINE);
    mqtt.publish(availabilityTopic, connected ? ONLINE : OFFLINE, true);
  };

  bleDevice.onConnectionChange(publish);
  publish(bleDevice.isConnected());
  bleDevice.startHealthMonitoring(healthCheckIntervalMs);
};
