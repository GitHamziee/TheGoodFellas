import { Component } from '@angular/core';
import { QaTransferReport } from '../qa-transfer-report';

/** Transfer Report — every QA verdict on a Junior Closer's intake. */
@Component({
  selector: 'app-qa-transfer-junior',
  imports: [QaTransferReport],
  template: `
    <app-qa-transfer-report
      lane="junior"
      peopleLabel="Junior Closers"
      subtitle="How QA scored each Junior Closer's submitted lead information — who's failing, why, and whether it's improving."
    />
  `,
})
export class QaTransferJunior {}
