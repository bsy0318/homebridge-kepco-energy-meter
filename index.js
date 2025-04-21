// homebridge-kepco-energy-meter/index.js
const https = require('https');
const crypto = require('crypto');
const axios = require('axios');
const NodeRSA = require('node-rsa');

let Service, Characteristic;

class KEPCOPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    // Configuration
    this.name = config.name || 'KEPCO Energy Meter';
    this.userId = config.userId;
    this.userPwd = config.userPwd;
    this.pollingInterval = config.pollingInterval || 10; // minutes

    // Default values
    this.currentPowerConsumption = 0;
    this.totalEnergyConsumption = 0;
    this.voltage = 220; // Default value for Korea
    this.current = 0;
    this.powerFactor = 0.95; // Default power factor

    // Start data polling when API is ready
    if (this.api) {
      this.api.on('didFinishLaunching', () => {
        this.log.info('KEPCO Energy Meter plugin initialized.');
        this.registerAccessories();
        this.startPolling();
      });
    }
  }

  // Configuration sample for homebridge configuration
  static getConfigurationSample() {
    return {
      "platform": "KEPCOEnergyMeter",
      "name": "KEPCO Energy Meter",
      "userId": "고객번호_또는_한전ON_ID",
      "userPwd": "파워플래너_PW",
      "pollingInterval": 10,
      "deviceId": "kepco-energy-meter",
      "deviceName": "KEPCO Energy Meter",
      "deviceType": "energymeter"
    };
  }

  // Start polling for power data
  startPolling() {
    this.log.debug('Starting power data polling');
    this.updatePowerData();
    
    // Set up interval for polling
    setInterval(() => {
      this.updatePowerData();
    }, this.pollingInterval * 60 * 1000); // Convert minutes to milliseconds
  }
  
  // Update power data by fetching directly from KEPCO
  async updatePowerData() {
    this.log.debug('Updating power data...');
    
    try {
      const data = await this.scrapingKEPCO(this.userId, this.userPwd);
      this.processPowerData(data);
    } catch (error) {
      this.log.error(`Failed to update power data: ${error.message}`);
    }
  }
  
  // Process the power data from KEPCO
  processPowerData(data) {
    if (!data) {
      this.log.error('No data received from KEPCO API');
      return;
    }
    
    try {
      this.log.debug(`Received data: ${JSON.stringify(data)}`);
      
      // Extract current power consumption (kWh to watts)
      if (data.F_AP_QT || data['실시간사용량(kWh)']) {
        const kWh = data.F_AP_QT || data['실시간사용량(kWh)'];
        // Convert to watts - assuming this is hourly data
        this.currentPowerConsumption = parseFloat(kWh) * 1000; // Convert kWh to Wh
      }
      
      // Extract total energy consumption
      if (data.PREDICT_TOT || data['예상_전력사용량']) {
        this.totalEnergyConsumption = parseFloat(data.PREDICT_TOT || data['예상_전력사용량']);
      }
      
      // Extract power factor if available
      if (data.F_LARAP_PF || data['역률(지상)']) {
        this.powerFactor = parseFloat(data.F_LARAP_PF || data['역률(지상)']);
      }
      
      // Calculate current based on power and voltage (P = V * I * PF)
      // I = P / (V * PF)
      if (this.currentPowerConsumption > 0) {
        this.current = this.currentPowerConsumption / (this.voltage * this.powerFactor);
      }
      
      this.log.info(`Updated power data: ${JSON.stringify({
        currentPowerConsumption: this.currentPowerConsumption,
        totalEnergyConsumption: this.totalEnergyConsumption,
        voltage: this.voltage,
        current: this.current,
        powerFactor: this.powerFactor
      })}`);
      
      // Update all registered accessories
      this.accessories.forEach(accessory => {
        // 전력 서비스
        const service = accessory.getService(Service.Outlet);
        if (service) {
          // 현재 전력 사용량을 On/Off 상태로 표시
          service.updateCharacteristic(
            Characteristic.On, 
            this.currentPowerConsumption > 0
          );
          
          // 현재 전력 소비량을 밝기 값으로 매핑 (0-100%)
          let brightness = Math.min(100, Math.max(0, (this.currentPowerConsumption / 5000) * 100));
          service.updateCharacteristic(
            Characteristic.Brightness, 
            brightness
          );
        }
        
        // 센서 서비스 - 현재 전력 소비량을 표시
        const powerService = accessory.getService('Current Power') ||
                             accessory.getService(Service.LightSensor);
        if (powerService) {
          // LightSensor의 CurrentAmbientLightLevel을 사용하여 현재 전력 표시
          powerService.updateCharacteristic(
            Characteristic.CurrentAmbientLightLevel, 
            Math.max(0.0001, this.currentPowerConsumption / 1000) // lux 값은 0.0001 이상이어야 함
          );
        }
        
        // 센서 서비스 - 총 에너지 소비량을 표시
        const totalEnergyService = accessory.getService('Total Energy') ||
                                  accessory.getService('Total Energy Consumption');
        if (totalEnergyService && totalEnergyService.getCharacteristic(Characteristic.CurrentTemperature)) {
          // 일부 센서는 온도 특성을 사용하여 데이터를 표시할 수 있음
          totalEnergyService.updateCharacteristic(
            Characteristic.CurrentTemperature, 
            this.totalEnergyConsumption
          );
        }
      });
    } catch (e) {
      this.log.error(`Error processing power data: ${e.message}`);
    }
  }

  // Main function to scrape KEPCO data - Reimplementation of powerplan.py in JavaScript
  async scrapingKEPCO(userId, userPwd) {
    const axiosInstance = axios.create({
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    try {
      // Step 1: Get initial cookies and RSA key
      this.log.debug('Connecting to KEPCO website...');
      const firstPageResponse = await axiosInstance.get('https://pp.kepco.co.kr/');
      
      // Extract cookies
      const cookies = firstPageResponse.headers['set-cookie'];
      if (!cookies || cookies.length < 3) {
        throw new Error('Failed to get cookies from KEPCO website');
      }

      // Extract cookie values
      const cookieRsa = this.extractCookieValue(cookies, 'cookieRsa');
      const cookieSsId = this.extractCookieValue(cookies, 'cookieSsId');
      const jsessionId = this.extractCookieValue(cookies, 'JSESSIONID');
      
      if (!cookieRsa || !cookieSsId || !jsessionId) {
        throw new Error('Failed to extract required cookies');
      }

      this.log.debug(`Got cookies: RSA=${cookieRsa.substring(0, 10)}..., SSID=${cookieSsId.substring(0, 10)}..., JSESSION=${jsessionId.substring(0, 10)}...`);
      
      // Create cookie string
      const cookieStr = `cookieSsId=${cookieSsId}; cookieRsa=${cookieRsa}; JSESSIONID=${jsessionId}`;
      
      // Extract RSA exponent
      const html = firstPageResponse.data;
      const rsaExponentMatch = html.match(/id="RSAExponent"\s+value="([^"]+)"/);
      if (!rsaExponentMatch) {
        throw new Error('Failed to extract RSA exponent');
      }
      const rsaExponent = rsaExponentMatch[1];
      this.log.debug(`Got RSA exponent: ${rsaExponent}`);

      // Step 2: Encrypt credentials with RSA
      const encryptedId = this.encryptRSA(userId, cookieRsa, rsaExponent);
      const encryptedPwd = this.encryptRSA(userPwd, cookieRsa, rsaExponent);
      
      if (!encryptedId || !encryptedPwd) {
        throw new Error('Failed to encrypt credentials');
      }

      // Format encrypted credentials
      const idWithSession = `${jsessionId}_${encryptedId}`;
      const pwWithSession = `${jsessionId}_${encryptedPwd}`;
      
      // Step 3: Login to KEPCO
      this.log.debug('Logging in to KEPCO...');
      const loginPayload = {
        RSAExponent: rsaExponent,
        USER_ID: idWithSession,
        USER_PWD: pwWithSession,
        viewType: 'web'
      };
      
      const loginResponse = await axiosInstance.post('https://pp.kepco.co.kr/login', 
        new URLSearchParams(loginPayload).toString(), 
        {
          headers: {
            'Cookie': cookieStr,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
      
      // Check login response
      if (loginResponse.status !== 200) {
        throw new Error(`Login failed with status ${loginResponse.status}`);
      }
      
      // Extract cookies from login response if they've changed
      const loginCookies = loginResponse.headers['set-cookie'];
      let updatedCookieStr = cookieStr;
      
      if (loginCookies && loginCookies.length > 0) {
        const updatedCookieRsa = this.extractCookieValue(loginCookies, 'cookieRsa') || cookieRsa;
        const updatedCookieSsId = this.extractCookieValue(loginCookies, 'cookieSsId') || cookieSsId;
        const updatedJsessionId = this.extractCookieValue(loginCookies, 'JSESSIONID') || jsessionId;
        
        updatedCookieStr = `cookieSsId=${updatedCookieSsId}; cookieRsa=${updatedCookieRsa}; JSESSIONID=${updatedJsessionId}`;
      }

      // Step 4: Get power usage data
      this.log.debug('Fetching power usage data...');
      const dataResponse = await axiosInstance.post(
        'https://pp.kepco.co.kr/rm/getRM0201.do',
        JSON.stringify({ menuType: "time", TOU: false }),
        {
          headers: {
            'Cookie': updatedCookieStr,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest'
          }
        }
      );
      
      // Process the response data
      const responseData = dataResponse.data;
      
      // Word replacements (similar to the Python code)
      const wordReplacements = {
        "BASE_BILL_UCOST": "기본요금단가",
        "BASE_BILL": "기본요금",
        "JOJ_KW": "요금적용전력",
        "CNTR_KND_NM": "전력요금제",
        "END_DT": "종료일",
        "DT": "시작일",
        "ELEC_CAR_CD": "공급코드",
        "ELEC_CAR_NM": "공급유형",
        "ET": "종료일",
        "F_AP_QT": "실시간사용량(kWh)",
        "JOJ_KW_TIME": "요금적용전력",
        "KWH_BILL": "전력량요금",
        "KWH_TYPE": "전력량요금코드",
        "PREDICT_BASE_BILL": "예상_기본요금단가",
        "PREDICT_BILL": "예상_전력량요금",
        "PREDICT_BILL_LEVEL": "예상_누진단계",
        "PREDICT_FUND_BILL": "예상_전력산업기반기금",
        "PREDICT_TOT": "예상_전력사용량",
        "PREDICT_TOTAL_CHARGE": "당월_예상_청구금액",
        "PREDICT_TOT_BILL": "당월_예상_사용액",
        "PREDICT_VAT_BILL": "당월_예상_부가세",
        "REAL_KWH_BILL": "실시간_전력사용량요금",
        "TOTAL_CHARGE": "실시간_요금",
        "VAT_BILL": "부가가치세",
        "UNIT_PRICE": "공급단가",
        "REAL_PREDICT_TOT_BILL": "예상_전력량요금",
        "START_DT": "검침시작일",
        "SELECT_DT": "업데이트"
      };
      
      // Return the data with Korean names
      return responseData;
      
    } catch (error) {
      this.log.error(`Error scraping KEPCO data: ${error.message}`);
      if (error.response) {
        this.log.error(`Response status: ${error.response.status}`);
        this.log.error(`Response data: ${JSON.stringify(error.response.data)}`);
      }
      throw error;
    }
  }
  
  // Helper function to extract cookie value from Set-Cookie header
  extractCookieValue(cookies, cookieName) {
    if (!cookies || !Array.isArray(cookies)) return null;
    
    for (const cookie of cookies) {
      const match = cookie.match(new RegExp(`${cookieName}=([^;]+)`));
      if (match) return match[1];
    }
    
    return null;
  }
  
  // Helper function to encrypt with RSA
  encryptRSA(text, modulus, exponent) {
    try {
      const key = new NodeRSA();
      // Set public key components
      key.importKey({
        n: Buffer.from(modulus, 'hex'),
        e: parseInt(exponent, 16)
      }, 'components-public');
      
      // Encrypt with PKCS1 padding
      return key.encrypt(text, 'hex');
    } catch (error) {
      this.log.error(`RSA encryption error: ${error.message}`);
      return null;
    }
  }

  // Configure cached accessories
  configureAccessory(accessory) {
    this.log.info('Configuring accessory %s', accessory.displayName);
    
    accessory.on('identify', () => {
      this.log.info('Identify requested for %s', accessory.displayName);
    });
    
    // 콘센트 서비스 추가 (On/Off + Brightness로 전력 사용량 표시)
    let outletService = accessory.getService(Service.Outlet);
    
    if (!outletService) {
      this.log.debug('Creating Outlet service for %s', accessory.displayName);
      outletService = accessory.addService(Service.Outlet, accessory.displayName);
      
      // 현재 전력 소비량을 밝기 특성으로 표시하기 위해 밝기 특성 추가
      outletService.addCharacteristic(Characteristic.Brightness);
    }
    
    // 현재 전력 소비량을 조명 센서로 표시 (보조 표시)
    let powerService = accessory.getService('Current Power');
    
    if (!powerService) {
      this.log.debug('Creating Light Sensor service for current power');
      powerService = accessory.addService(Service.LightSensor, 'Current Power', 'current-power');
    }
    
    // 총 에너지 소비량을 온도 센서로 표시 (보조 표시)
    let totalEnergyService = accessory.getService('Total Energy');
    
    if (!totalEnergyService) {
      this.log.debug('Creating Temperature Sensor service for total energy');
      totalEnergyService = accessory.addService(Service.TemperatureSensor, 'Total Energy', 'total-energy');
    }
    
    // On 특성 설정
    outletService.getCharacteristic(Characteristic.On)
      .onGet(() => this.currentPowerConsumption > 0);
    
    // Brightness 특성 설정
    outletService.getCharacteristic(Characteristic.Brightness)
      .onGet(() => {
        let brightness = Math.min(100, Math.max(0, (this.currentPowerConsumption / 5000) * 100));
        return brightness;
      });
    
    // LightSensor(현재 전력) 특성 설정
    powerService.getCharacteristic(Characteristic.CurrentAmbientLightLevel)
      .onGet(() => Math.max(0.0001, this.currentPowerConsumption / 1000));
    
    // TemperatureSensor(총 에너지) 특성 설정
    totalEnergyService.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(() => this.totalEnergyConsumption);
    
    // Add to the array of accessories
    this.accessories.push(accessory);
  }
  
  // Register new accessories
  registerAccessories() {
    const uuid = this.api.hap.uuid.generate('homebridge-kepco-energy-meter');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    
    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      this.configureAccessory(existingAccessory);
    } else {
      this.log.info('Adding new accessory:', this.name);
      
      const accessory = new this.api.platformAccessory(this.name, uuid);
      
      // Set device information
      accessory.getService(Service.AccessoryInformation)
        .setCharacteristic(Characteristic.Manufacturer, 'KEPCO')
        .setCharacteristic(Characteristic.Model, 'Energy Meter')
        .setCharacteristic(Characteristic.SerialNumber, 'KEPCO-001')
        .setCharacteristic(Characteristic.FirmwareRevision, '1.0.0');
      
      // Configure the new accessory
      this.configureAccessory(accessory);
      
      // Register the accessory
      this.api.registerPlatformAccessories('homebridge-kepco-energy-meter', 'KEPCOEnergyMeter', [accessory]);
    }
  }
}

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;
  
  api.registerPlatform('homebridge-kepco-energy-meter', 'KEPCOEnergyMeter', KEPCOPlatform);
};