import { Component, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

/** Embeds the Insurance Toolkits FEX Lite quoting form. Shared by CLOSER, QA_CLOSER, ADMIN, MANAGER. */
@Component({
  selector: 'app-toolkit',
  template: `
    <div class="page toolkit-page">
      <iframe class="toolkit-frame" title="Final Expense Quoter" [src]="src"></iframe>
    </div>
  `,
  styles: `
    .toolkit-page {
      display: flex;
      justify-content: center;
    }
    .toolkit-frame {
      display: block;
      border: none;
      width: 100%;
      max-width: 520px;
      height: 900px;
    }
  `,
})
export class Toolkit {
  protected readonly src = inject(DomSanitizer).bypassSecurityTrustResourceUrl(
    'https://insurancetoolkits.com/fex/lite-form/?token=aEPIcTO6J2JcUnqoX_HJct2rNW0NOxDnIZ7xouR6',
  );
}
