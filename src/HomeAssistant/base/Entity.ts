import { IMQTTConnection } from '@mqtt/IMQTTConnection';
import { Dictionary } from '@utils/Dictionary';
import { safeId } from '@utils/safeId';
import { seconds } from '@utils/seconds';
import { IDeviceData } from '../IDeviceData';
import { ComponentType as EntityWithStateComponentType } from './ComponentTypeWithState';
import { IAvailable } from './IAvailable';

const ONLINE = 'online';
const OFFLINE = 'offline';
type ComponentType = 'button' | 'cover' | EntityWithStateComponentType;

export type EntityConfig = {
  description: string;
  category?: string;
  icon?: string;
};

export class Entity implements IAvailable {
  protected baseTopic: string;
  private availabilityTopic: string;
  private entityTag: string;
  private uniqueId: string;
  // Neither availability nor state messages are retained on the broker, so if HA
  // Core (not just this add-on) restarts, an entity's one-time initial availability
  // publish is long gone and nothing re-sends it - the entity just shows unavailable
  // forever until something unrelated happens to change its state. Track the last
  // availability we actually set so it can be replayed once HA reports back online,
  // rather than assuming every entity should always come back "online" regardless of
  // whether it was legitimately set offline for some other reason.
  private lastAvailability: string = ONLINE;

  constructor(
    protected mqtt: IMQTTConnection,
    protected deviceData: IDeviceData,
    protected entityConfig: EntityConfig,
    private componentType: ComponentType
  ) {
    this.entityTag = safeId(entityConfig.description);
    this.uniqueId = `${safeId(deviceData.device.name)}_${this.entityTag}`;
    this.baseTopic = `${deviceData.deviceTopic}/${this.entityTag}`;
    this.availabilityTopic = `${this.baseTopic}/status`;
    this.mqtt.subscribe('homeassistant/status');
    this.mqtt.on('homeassistant/status', (message) => {
      if (message === ONLINE)
        setTimeout(() => {
          this.publishDiscovery();
          this.sendAvailability(this.lastAvailability);
        }, seconds(15));
    });
    setTimeout(() => this.publishDiscovery(), 50);
  }

  publishDiscovery() {
    const discoveryTopic = `homeassistant/${this.componentType}/${this.deviceData.deviceTopic}_${this.entityTag}/config`;
    const discoveryMessage = {
      name: this.entityConfig.description,
      unique_id: this.uniqueId,
      device: this.deviceData.device,
      ...this.discoveryState(),
    };

    this.mqtt.publish(discoveryTopic, discoveryMessage);
  }

  protected discoveryState(): Dictionary<any> {
    return {
      availability_topic: this.availabilityTopic,
      payload_available: ONLINE,
      payload_not_available: OFFLINE,
      ...(this.entityConfig.category ? { entity_category: this.entityConfig.category } : {}),
      ...(this.entityConfig.icon ? { icon: this.entityConfig.icon } : {}),
    };
  }

  setOffline() {
    this.sendAvailability(OFFLINE);
    return this;
  }

  setOnline() {
    this.sendAvailability(ONLINE);
    return this;
  }

  private sendAvailability(availability: string) {
    this.lastAvailability = availability;
    setTimeout(() => this.mqtt.publish(this.availabilityTopic, availability), 500);
  }
}
