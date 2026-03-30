import {
  API,
  Service,
  PlatformAccessory,
  Characteristic,
  Logger,
} from 'homebridge';

export class WanStatusAccessory {
  private readonly accessory: PlatformAccessory;
  private readonly service: Service;

  constructor(
    private readonly log: Logger,
    private readonly api: API,
    private readonly name: string,
  ) {
    this.accessory = new this.api.platformAccessory(name, this.api.hap.uuid.generate(name));
    this.accessory.category = this.api.hap.Categories.SENSOR;

    this.service = this.accessory.addService(this.api.hap.Service.ContactSensor, name);

    this.service
      .getCharacteristic(this.api.hap.Characteristic.ContactSensorState)
      .onGet(() => {
        // Return the last known state
        return this.service.getCharacteristic(this.api.hap.Characteristic.ContactSensorState).value || this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED;
      });
  }

  getAccessory(): PlatformAccessory {
    return this.accessory;
  }

  updateStatus(isOnline: boolean): void {
    const state = isOnline
      ? this.api.hap.Characteristic.ContactSensorState.CONTACT_DETECTED
      : this.api.hap.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
    this.service
      .getCharacteristic(this.api.hap.Characteristic.ContactSensorState)
      .updateValue(state);
    this.log.debug(`${this.name}: ${isOnline ? 'Online' : 'Offline'}`);
  }
}