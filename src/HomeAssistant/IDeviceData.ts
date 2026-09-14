export interface IDeviceData {
  deviceTopic: string;
  device: IDevice;
  // Device-level MQTT topic reflecting real BLE connection health (connected+healthy vs.
  // disconnected/stale), independent of individual entity state. When set, Entity additionally
  // gates its HA availability on this topic (see Entity.discoveryState) so entities correctly go
  // `unavailable` when the underlying BLE link dies, not just when this add-on's MQTT client
  // stays up. Populated by buildMQTTDeviceData; published by BLE/setupConnectionAvailability.
  availabilityTopic?: string;
}

interface IDevice {
  ids: string[];
  name: string;
  mf: string;
  mdl: string;
}
