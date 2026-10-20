import { Component } from '@angular/core';
import { QaTransferReport } from '../qa-transfer-report';

/** Transfer Report — every QA verdict on a Closer's enrichment. */
@Component({
  selector: 'app-qa-transfer-closer',
  imports: [QaTransferReport],
  template: `
    <app-qa-transfer-report lane="closer" peopleLabel="Closers" />
  `,
})
export class QaTransferCloser {}
