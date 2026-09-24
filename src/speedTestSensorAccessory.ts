import { AccessoryPlugin, API, Logger, Service } from 'homebridge';

// HomeKit's CurrentAmbientLightLevel range.
const clamp = (mbps: number): number => Math.min(Math.max(Number.isFinite(mbps) ? mbps : 0, 0.0001), 100000);

/** Result of UniFi's last scheduled speed test in Mbps, shown as a Light Sensor (1 Mbps = 1 lux). */
export class SpeedTestSensorAccessory implements AccessoryPlugin {
  private readonly service: Service;
  private readonly info: Service;
  private speed = 0;

  constructor(private readonly log: Logger, private readonly api: API, public readonly name: string, type: string) {
    const { Service: S, Characteristic: C } = api.hap;
    this.service = new S.LightSensor(name);
    this.service.getCharacteristic(C.CurrentAmbientLightLevel).onGet(() => clamp(this.speed));
    this.info = new S.AccessoryInformation()
      .setCharacteristic(C.Manufacturer, 'Ubiquiti')
      .setCharacteristic(C.Model, `Speed test ${type}`)
      .setCharacteristic(C.SerialNumber, `unifi-speedtest-${type}`);
  }

  getServices(): Service[] {
    return [this.info, this.service];
  }

  /** A null reading (UniFi reported no speed test result) keeps the last value. */
  updateSpeed(mbps: number | null): void {
    if (mbps === null) {
      this.log.debug(`${this.name}: no speed test result reported`);
      return;
    }
    this.speed = mbps;
    this.service.updateCharacteristic(this.api.hap.Characteristic.CurrentAmbientLightLevel, clamp(mbps));
    this.log.debug(`${this.name}: ${mbps} Mbps`);
  }
}
