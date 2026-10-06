import { Component } from '@angular/core';
import { QaCallReport } from '../qa-call-report';

/** Live Call Report — issues flagged against Junior Closers. */
@Component({
  selector: 'app-qa-live-call-junior',
  imports: [QaCallReport],
  template: `
    <app-qa-call-report
      lane="junior"
      peopleLabel="Junior Closers"
      subtitle="Live-call issues QA has flagged for each Junior Closer — repeat offenders, trend and full comment history."
    />
  `,
})
export class QaLiveCallJunior {}
