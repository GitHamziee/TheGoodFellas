import { Component } from '@angular/core';
import { QaTransferReport } from '../qa-transfer-report';

/** Transfer Report — every QA verdict on a Junior Closer's intake. */
@Component({
  selector: 'app-qa-transfer-junior',
  imports: [QaTransferReport],
  template: `
    <app-qa-transfer-report lane="junior" peopleLabel="Junior Closers" />
  `,
})
export class QaTransferJunior {}
