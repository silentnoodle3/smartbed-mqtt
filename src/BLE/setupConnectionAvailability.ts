import { IDeviceData } from '@ha/IDeviceData';
import { Sensor } from '@ha/Sensor';
import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { logInfo } from '@utils/logger';
import { buildEntityConfig } from 'Common/buildEntityConfig';
import { BLEConnectionStats, IBLEDevice } from 'ESPHome/types/IBLEDevice';

const ONLINE = 'online';
const OFFLINE = 'offline';

const DIAGNOSTIC = { category: 'diagnostic' };
const TIMESTAMP = { category: 'diagnostic', deviceClass: 'timestamp' };

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

  const diagnostics = buildDiagnosticSensors(mqtt, deviceData);

  const onChange = (connected: boolean) => {
    publish(connected);
    diagnostics(bleDevice.getConnectionStats());
  };

  bleDevice.onConnectionChange(onChange);
  publish(bleDevice.isConnected());
  diagnostics(bleDevice.getConnectionStats());
  bleDevice.startHealthMonitoring(healthCheckIntervalMs);
};

// Exposes the link's own history as diagnostic entities, so "how often does this actually drop?"
// is answerable from a dashboard instead of by grepping add-on logs before they rotate. Filed under
// the diagnostic category, so they stay out of the way of the actual bed controls.
//
// Retained: these only change on a connection-state change, which (correctly) may not happen for
// a long time - without retain, an HA Core restart in between wipes them to "unknown" with nothing
// to repopulate them until the next actual drop or reconnect.
const buildDiagnosticSensors = (mqtt: IMQTTConnection, deviceData: IDeviceData) => {
  const disconnects = new Sensor<number>(mqtt, deviceData, buildEntityConfig('BLEDisconnects', DIAGNOSTIC), true);
  const connectedSince = new Sensor<string>(mqtt, deviceData, buildEntityConfig('BLEConnectedSince', TIMESTAMP), true);
  const lastDisconnect = new Sensor<string>(mqtt, deviceData, buildEntityConfig('BLELastDisconnect', TIMESTAMP), true);

  return ({ connectedSince: since, lastDisconnectAt, disconnectCount }: BLEConnectionStats) => {
    disconnects.setState(disconnectCount);
    // null leaves the entity unavailable rather than showing a stale or invented timestamp - which
    // is the honest state before the first connect, and between a drop and its reconnect.
    connectedSince.setState(since ? since.toISOString() : null);
    lastDisconnect.setState(lastDisconnectAt ? lastDisconnectAt.toISOString() : null);
  };
};
