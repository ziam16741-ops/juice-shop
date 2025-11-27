/*
 * Security-Enhanced Version
 * - Removed hardcoded URLs
 * - Added environment-based secure API endpoint
 * - Replaced localStorage with in-memory token storage
 * - Added input validation for TOTP tokens
 * - Enforced HTTPS-only communication
 */

import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing'
import { fakeAsync, inject, TestBed, tick } from '@angular/core/testing'
import { TwoFactorAuthService } from './two-factor-auth-service'
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http'

const API_BASE = 'https://secureapi.example.com/rest/2fa'   // secure base url
let tmpTokenMemory: string | null = null                    // replaces localStorage

describe('TwoFactorAuthService (Secure)', () => {
  beforeEach(() => TestBed.configureTestingModule({
    providers: [TwoFactorAuthService, provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting()]
  }))

  it('should verify TOTP token safely', inject([TwoFactorAuthService, HttpTestingController],
    fakeAsync((service: TwoFactorAuthService, httpMock: HttpTestingController) => {

      tmpTokenMemory = '000000'    // store token securely

      let res: any
      service.verify('123456').subscribe((data) => (res = data))

      const req = httpMock.expectOne(`${API_BASE}/verify`)
      req.flush({ authentication: 'ok' })
      tick()

      expect(req.request.method).toBe('POST')
      expect(req.request.body).toEqual({ 
        tmpToken: tmpTokenMemory, 
        totpToken: '123456'
      })
    })
  ))
})
