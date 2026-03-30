import {
  API,
  Service,
  PlatformAccessory,
  Characteristic,
  Logger,
} from 'homebridge';

export class SpeedSensorAccessory {
  private readonly accessory: PlatformAccessory;
  private readonly service: Service;

  constructor(
    private readonly log: Logger,
    private readonly api: API,
    private readonly name: string,
    private readonly type: 'download' | 'upload',
  ) {
    this.accessory = new this.api.platformAccessory(name, this.api.hap.uuid.generate(name));
    this.accessory.category = this.api.hap.Categories.SENSOR;

    this.service = this.accessory.addService(this.api.hap.Service.LightSensor, name);

    this.service
      .getCharacteristic(this.api.hap.Characteristic.CurrentAmbientLightLevel)
      .onGet(() => {
        // Return the last known speed value
        return this.service.getCharacteristic(this.api.hap.Characteristic.CurrentAmbientLightLevel).value || 0;
      });
  }

  getAccessory(): PlatformAccessory {
    return this.accessory;
  }

  updateSpeed(speedMbps: number): void {
    this.service
      .getCharacteristic(this.api.hap.Characteristic.CurrentAmbientLightLevel)
      .updateValue(speedMbps);
    this.log.debug(`${this.name}: ${speedMbps} Mbps`);
  }
}