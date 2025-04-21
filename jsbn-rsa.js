const { BigInteger } = require('jsbn');
const { SecureRandom } = require('jsbn');

function pkcs1pad2(s, n) {
  if(n < s.length + 11) {
    console.error("Message too long for RSA");
    return null;
  }
  
  const ba = new Array();
  let i = s.length - 1;
  
  while(i >= 0 && n > 0) {
    const c = s.charCodeAt(i--);
    if(c < 128) { // encode using utf-8
      ba[--n] = c;
    }
    else if((c > 127) && (c < 2048)) {
      ba[--n] = (c & 63) | 128;
      ba[--n] = (c >> 6) | 192;
    }
    else {
      ba[--n] = (c & 63) | 128;
      ba[--n] = ((c >> 6) & 63) | 128;
      ba[--n] = (c >> 12) | 224;
    }
  }
  
  ba[--n] = 0;
  const rng = new SecureRandom();
  const x = new Array(1);
  
  while(n > 2) { // random non-zero pad
    x[0] = 0;
    while(x[0] == 0) rng.nextBytes(x);
    ba[--n] = x[0];
  }
  
  ba[--n] = 2;
  ba[--n] = 0;
  
  return new BigInteger(ba);
}

class JSBNRSAKey {
  constructor() {
    this.n = null;
    this.e = 0;
  }
  
  // 공개키 설정 (N = 모듈러스, E = 지수)
  setPublic(N, E) {
    if(N != null && E != null && N.length > 0 && E.length > 0) {
      this.n = new BigInteger(N, 16); // 16진수 모듈러스
      this.e = parseInt(E, 16);       // 16진수 지수
      return true;
    }
    return false;
  }
  
  // 암호화 연산 수행
  doPublic(x) {
    return x.modPow(new BigInteger(this.e.toString(), 10), this.n);
  }
  
  // 텍스트 암호화
  encrypt(text) {
    const m = pkcs1pad2(text, (this.n.bitLength() + 7) >> 3);
    if(m == null) return null;
    
    const c = this.doPublic(m);
    if(c == null) return null;
    
    let h = c.toString(16);
    if((h.length & 1) == 0) return h; else return "0" + h;
  }
}

// KEPCO 로그인에 사용할 함수
function encryptJSBN(text, modulus, exponent) {
  const rsa = new JSBNRSAKey();
  const success = rsa.setPublic(modulus, exponent);
  
  if (!success) {
    throw new Error('Failed to set RSA public key');
  }
  
  return rsa.encrypt(text);
}

module.exports = {
  JSBNRSAKey,
  encryptJSBN
};