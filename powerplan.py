import json
import datetime
import requests
from bs4 import BeautifulSoup as bs
from jsbn import RSAKey

now = datetime.datetime.now()
header = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.77 Safari/537.36',
    'Content-Type': 'application/x-www-form-urlencoded'
}

def concat_cookies(cookie_jar):
    cookie_rsa = cookie_jar.values()[1]
    cookie_ssid = cookie_jar.values()[0]
    jsession_id = cookie_jar.values()[2]
    cookie_str = 'cookieSsId=' + cookie_ssid + '; ' + 'cookieRsa=' + cookie_rsa + '; ' + 'JSESSIONID=' + jsession_id
    return cookie_str

def scraping(USER_ID, USER_PWD, scrap_date = now.strftime('%Y-%m-%d'), simple=True):
    with requests.Session() as s:
        base_url = 'https://pp.kepco.co.kr/'
        login_url = 'https://pp.kepco.co.kr/login'

        LOGIN_INFO = {'USER_ID': USER_ID, 'USER_PWD': USER_PWD}
        first_page = s.get(base_url)
        cookie_rsa = s.cookies.values()[1]
        cookie_ssid = s.cookies.values()[0]
        jsession_id = s.cookies.values()[2]
        cookie_str = concat_cookies(s.cookies)
        header['Cookie'] = cookie_str

        html = first_page.text
        soup = bs(html, 'html.parser')
        rsa_exponent = soup.find('input', {'id': 'RSAExponent'})['value'] # == 10001
        rsa = RSAKey()
        rsa.setPublic(cookie_rsa, rsa_exponent)

        id = jsession_id + '_' + rsa.encrypt(LOGIN_INFO['USER_ID'])
        pw = jsession_id + '_' + rsa.encrypt(LOGIN_INFO['USER_PWD'])

        payload = {'RSAExponent': rsa_exponent, 'USER_ID': id, 'USER_PWD': pw, 'viewType': 'web'}

        s.post(login_url, headers=header, data=payload)

        data_30 = {
            'SELECT_DT': scrap_date,
            'TIME_TYPE': "1",
            'selectType': "all"
        }

        header['Content-Type'] = 'application/json'
        header['Accept'] = 'application/json, text/javascript, */*; q=0.01'
        header['X-Requested-With'] = 'XMLHttpRequest'
        cookie_str = concat_cookies(s.cookies)
        header['Cookie'] = cookie_str
        
        if simple != True:
            res = s.post('https://pp.kepco.co.kr/rs/rs0201_chart.do', json=data_30, headers=header)
        else:
            res = s.post('https://pp.kepco.co.kr/rm/getRM0201.do', json={"menuType":"time","TOU":False}, headers=header)
        
        dic_word_detail = {"F_AP_QT":"사용량(kWh)", "F_LARAP_QT":"무효전력(지상)","F_LERAP_QT":"무효전력(진상)",
        "SUM_QT":"무효전력 합계","F_LARAP_PF":"역률(지상)","F_LERAP_PF":"역률(진상)", "MR_HHMI2":"시간(HH:mm)", "MR_HHMI":"시간(한글)",
        "CO2":"탄소배출량", "LDAY":"전일","LMONTH":"전월", "AVG":"평균"}
        dic_word_simple = {"BASE_BILL_UCOST":"기본요금단가", "BASE_BILL":"기본요금", "JOJ_KW":"요금적용전력", "CNTR_KND_NM":"전력요금제","END_DT":"종료일",
        "DT":"시작일", "ELEC_CAR_CD":"공급코드", "ELEC_CAR_NM":"공급유형", "END_DT":"업데이트", "ET":"종료일", "F_AP_QT":"실시간사용량(kWh)",
        "JOJ_KW":"요금적용전력코드", "JOJ_KW_TIME":"요금적용전력", "KWH_BILL":"전력량요금", "KWH_TYPE":"전력량요금코드", "PREDICT_BASE_BILL":"예상_기본요금단가",
        "PREDICT_BILL":"예상_전력량요금", "PREDICT_BILL_LEVEL":"예상_누진단계", "PREDICT_FUND_BILL":"예상_전력산업기반기금", "PREDICT_TOT":"예상_전력사용량",
        "PREDICT_TOTAL_CHARGE":"당월_예상_청구금액", "PREDICT_TOT_BILL":"당월_예상_사용액", "PREDICT_VAT_BILL":"당월_예상_부가세",
        "REAL_KWH_BILL":"실시간_전력사용량요금", "TOTAL_CHARGE":"실시간_요금", "VAT_BILL":"부가가치세", "UNIT_PRICE":"공급단가", "REAL_PREDICT_TOT_BILL":"예상_전력량요금",
        "START_DT":"검침시작일", "SELECT_DT":"업데이트"}
        
        # F_LARAP_QT: 무효전력(지상)
        # F_LERAP_QT: 무효전력(진상)
        # MR_HHMI: 시간
        # F_AP_QT: 사용량
        # LDAY_F_AP_QT : 전일 사용량
        # LMONTH_F_AP_QT : 전월동일 사용량
        # AVG_F_AP_QT : 평균 사용량
        # MAX_PWR: 최대수요
        # F_LARAP_PF: 역률(지상)
        # F_LERAP_PF: 역률(진상)
        # SUM_QT : 무효합계
        # CO2 : 탄소배출량
        # LDAY_CO2 : 전일 탄소배출량
        # LMONTH_CO2 : 전월동일 탄소배출량
        # AVG_CO2 : 평균 탄소배출량
        
        text_data_list = res.text
        main_data_list = None
        
        if not simple:
            for word, replacement in dic_word_detail.items():
                text_data_list = text_data_list.replace(word, replacement)
            main_data_list = json.loads(text_data_list)
            main_data_list.insert(0,{'DateTime':scrap_date, 'Data':json.loads(text_data_list)})
            del main_data_list[1:]
        else:
            for word, replacement in dic_word_simple.items():
                text_data_list = text_data_list.replace('"'+word+'"', '"'+replacement+'"')
            main_data_list = json.loads(text_data_list)
        return main_data_list

