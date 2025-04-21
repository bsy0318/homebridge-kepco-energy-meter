// playwright-kepco-login.js
// 브라우저 자동화를 통한 KEPCO 로그인 구현
const https = require('https');
const axios = require('axios');
const { chromium } = require('playwright');

class KEPCOLogin {
  constructor(log) {
    this.log = log || console;
    this.browser = null;
    this.isInitialized = false;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  /**
   * 브라우저 초기화
   */
  async initBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        this.log.debug('Browser already closed or failed to close');
      }
    }

    try {
      this.log.debug('Launching browser...');
      
      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1280,720'
        ]
      };
      
      // 환경 변수가 설정된 경우 Chrome 경로 사용
      if (process.env.CHROME_PATH) {
        launchOptions.executablePath = process.env.CHROME_PATH;
        this.log.debug(`Using custom Chrome path: ${process.env.CHROME_PATH}`);
      }
      
      this.browser = await chromium.launch(launchOptions);
      this.isInitialized = true;
      this.log.debug('Browser launched successfully');
      return true;
    } catch (error) {
      this.log.error(`Failed to initialize browser: ${error.message}`);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * 브라우저 종료
   */
  async closeBrowser() {
    if (this.browser) {
      try {
        await this.browser.close();
        this.browser = null;
        this.isInitialized = false;
        this.log.debug('Browser closed successfully');
      } catch (error) {
        this.log.error(`Failed to close browser: ${error.message}`);
      }
    }
  }

  /**
   * KEPCO 사이트 로그인 - 실제 브라우저 사용
   * @returns {Object} 쿠키 및 세션 정보
   */
  async login(userId, userPwd) {
    if (this.retryCount >= this.maxRetries) {
      this.log.error(`Exceeded maximum login retries (${this.maxRetries})`);
      this.retryCount = 0;
      throw new Error('로그인 최대 재시도 횟수 초과');
    }

    // 브라우저 초기화
    if (!this.isInitialized) {
      const initialized = await this.initBrowser();
      if (!initialized) {
        throw new Error('브라우저 초기화 실패');
      }
    }

    let page = null;
    let context = null;
    try {
      // 새 브라우저 컨텍스트 생성
      context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36',
        viewport: { width: 1280, height: 720 }
      });
      
      // 새 페이지 열기
      page = await context.newPage();
      
      // 로그인 페이지로 이동
      this.log.debug('로그인 페이지 로딩 중...');
      await page.goto('https://pp.kepco.co.kr/', {
        waitUntil: 'networkidle',
        timeout: 30000
      });
      
      // 로그인 폼이 로드되었는지 확인
      await page.waitForSelector('#RSA_USER_ID', { state: 'visible', timeout: 10000 });
      await page.waitForSelector('#RSA_USER_PWD', { state: 'visible', timeout: 10000 });
      
      // ID와 비밀번호 입력
      this.log.debug('로그인 정보 입력 중...');
      await page.fill('#RSA_USER_ID', userId);
      await page.fill('#RSA_USER_PWD', userPwd);
      
      // 로그인 폼 제출
      this.log.debug('로그인 시도 중...');
      await Promise.all([
        page.click('.intro_btn[value="로그인"]'),
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 })
      ]);
      
      // 로그인 성공 여부 확인
      const loginFailed = await page.evaluate(() => {
        return document.querySelector('#RSA_USER_ID') !== null || 
                document.querySelector('#RSA_USER_PWD') !== null;
      });
      
      if (loginFailed) {
        const errorMsg = await page.evaluate(() => {
          const alert = document.querySelector('.alert-message');
          return alert ? alert.textContent.trim() : '로그인 실패: 로그인 폼이 여전히 표시됨';
        });
        throw new Error(errorMsg || '로그인 실패: 알 수 없는 오류');
      }
      
      this.log.debug('로그인 성공. 쿠키 및 세션 정보 수집 중...');
      
      // 쿠키 수집
      const cookies = await context.cookies();
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      
      // 로그인 상태 추가 확인
      const isLoggedIn = await page.evaluate(() => {
        return document.querySelector('.welcome') !== null || 
                document.querySelector('.logout') !== null || 
                !document.querySelector('#RSA_USER_ID');
      });
      
      if (!isLoggedIn) {
        throw new Error('로그인 상태를 확인할 수 없습니다.');
      }
      
      this.log.info('KEPCO 로그인 성공');
      this.retryCount = 0; // 성공 시 재시도 카운트 초기화
      
      // 세션 정보 반환
      return {
        cookieStr,
        referer: page.url(),
        sessionValid: true,
        page, // 페이지 객체를 반환하여 데이터 요청에 사용
        context // 컨텍스트 객체도 함께 반환
      };
      
    } catch (error) {
      this.log.error(`KEPCO 로그인 오류: ${error.message}`);
      
      // 페이지 스크린샷 캡처 (디버깅용)
      if (page) {
        try {
          const screenshot = await page.screenshot({ path: '/tmp/kepco-error.png' });
          this.log.debug(`에러 발생 시점 화면 캡처됨: /tmp/kepco-error.png`);
        } catch (screenshotError) {
          this.log.error(`스크린샷 캡처 실패: ${screenshotError.message}`);
        }
        
        // 페이지 닫기
        await page.close().catch(e => this.log.error(`페이지 닫기 실패: ${e.message}`));
      }
      
      if (context) {
        await context.close().catch(e => this.log.error(`컨텍스트 닫기 실패: ${e.message}`));
      }
      
      // 브라우저 재초기화
      await this.closeBrowser();
      await this.initBrowser();
      
      // 재시도
      this.retryCount++;
      this.log.debug(`로그인 재시도 (${this.retryCount}/${this.maxRetries})...`);
      
      // 잠시 대기 후 재시도
      await new Promise(resolve => setTimeout(resolve, 3000));
      return this.login(userId, userPwd);
    }
  }

  /**
   * KEPCO API로부터 전력 사용량 데이터 가져오기
   */
  async getPowerData(sessionInfo, simple = true, scrapDate = new Date().toISOString().split('T')[0]) {
    if (!sessionInfo || !sessionInfo.sessionValid || !sessionInfo.page) {
      throw new Error('유효한 세션 정보가 없습니다. 다시 로그인이 필요합니다.');
    }
    
    const page = sessionInfo.page;
    
    try {
      // 데이터 페이지로 이동 (실시간 모니터링)
      this.log.debug('전력 데이터 페이지 로딩 중...');
      await page.goto('https://pp.kepco.co.kr/rm/rm0201.do', {
        waitUntil: 'networkidle',
        timeout: 30000
      });
      
      // 페이지 로딩 대기
      await page.waitForSelector('.cont_area', { state: 'visible', timeout: 15000 });
      
      // JavaScript를 통해 데이터 추출
      this.log.debug('전력 데이터 추출 중...');
      const powerData = await page.evaluate(() => {
        // 브라우저 콘솔에서 실행되는 코드
        try {
          // 데이터 요소 찾기
          const realTimeUsage = document.querySelector('.kwh');
          const predictedUsage = document.querySelector('.predict-current');
          const monthlyBill = document.querySelector('.price');
          
          // 데이터 파싱
          const data = {
            '실시간사용량(kWh)': realTimeUsage ? parseFloat(realTimeUsage.textContent.replace(/[^0-9.]/g, '')) : 0,
            '예상_전력사용량': predictedUsage ? parseFloat(predictedUsage.textContent.replace(/[^0-9.]/g, '')) : 0,
            '당월_예상_청구금액': monthlyBill ? parseFloat(monthlyBill.textContent.replace(/[^0-9.]/g, '')) : 0
          };
          
          return data;
        } catch (error) {
          console.error(`데이터 추출 오류: ${error.message}`);
          return { error: error.message };
        }
      });
      
      // 추출된 데이터 확인
      if (powerData.error) {
        throw new Error(`데이터 추출 중 오류: ${powerData.error}`);
      }
      
      this.log.debug(`추출된 전력 데이터: ${JSON.stringify(powerData)}`);
      
      // 상세 데이터가 필요한 경우 API 요청을 인터셉트하여 얻을 수도 있음
      if (!simple) {
        this.log.debug('상세 전력 데이터 요청 중...');
        // 네트워크 요청 모니터링 설정
        let detailedData = null;
        
        const responsePromise = page.waitForResponse(
          response => response.url().includes('getRM0201.do'),
          { timeout: 10000 }
        );
        
        // API 요청 트리거
        await page.evaluate(() => {
          // 브라우저에서 API 요청 트리거
          if (typeof refreshMain === 'function') {
            refreshMain();
          }
        });
        
        // API 응답 대기
        try {
          const response = await responsePromise;
          if (response.ok()) {
            detailedData = await response.json();
            this.log.debug('상세 API 데이터 수신 성공');
          }
        } catch (e) {
          this.log.warn(`API 응답 대기 시간 초과 또는 오류: ${e.message}`);
        }
        
        if (detailedData) {
          // API 데이터와 HTML 데이터를 병합
          return { ...powerData, ...detailedData };
        }
      }
      
      return powerData;
      
    } catch (error) {
      this.log.error(`전력 데이터 조회 오류: ${error.message}`);
      
      // 페이지가 유효한지 확인
      let isPageValid = false;
      try {
        isPageValid = page && await page.evaluate(() => true).catch(() => false);
      } catch (e) {
        isPageValid = false;
      }
      
      // 페이지가 유효하면 로그인 상태 확인
      if (isPageValid) {
        const isLoggedIn = await page.evaluate(() => {
          return document.querySelector('#RSA_USER_ID') === null;
        }).catch(() => false);
        
        if (!isLoggedIn) {
          this.log.warn('세션이 만료되었습니다. 다시 로그인이 필요합니다.');
          return null; // 세션 만료 상태 반환
        }
      } else {
        this.log.warn('페이지가 유효하지 않습니다. 다시 로그인이 필요합니다.');
        return null;
      }
      
      throw error;
    }
  }
  
  /**
   * 세션 정리 및 브라우저 종료
   */
  async cleanup(sessionInfo) {
    try {
      if (sessionInfo) {
        if (sessionInfo.page) {
          await sessionInfo.page.close().catch(e => 
            this.log.debug(`페이지 정리 중 오류: ${e.message}`));
        }
        
        if (sessionInfo.context) {
          await sessionInfo.context.close().catch(e => 
            this.log.debug(`컨텍스트 정리 중 오류: ${e.message}`));
        }
      }
    } catch (e) {
      this.log.debug(`세션 정리 중 오류: ${e.message}`);
    }
    
    await this.closeBrowser();
  }
}

module.exports = KEPCOLogin;