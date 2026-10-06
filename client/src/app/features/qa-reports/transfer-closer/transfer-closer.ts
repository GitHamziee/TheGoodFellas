import { Component } from '@angular/core';
import { QaTransferReport } from '../qa-transfer-report';

/** Transfer Report — every QA verdict on a Closer's enrichment. */
@Component({
  selector: 'app-qa-transfer-closer',
  imports: [QaTransferReport],
  template: `
    <app-qa-transfer-report
      lane="closer"
      peopleLabel="Closers"
      subtitle="How QA scored each Closer's lead enrichment — who's failing, why, and whether it's improving."
    />
  `,
})
export class QaTransferCloser {}
