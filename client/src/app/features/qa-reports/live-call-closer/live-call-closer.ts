import { Component } from '@angular/core';
import { QaCallReport } from '../qa-call-report';

/** Live Call Report — issues flagged against Closers. */
@Component({
  selector: 'app-qa-live-call-closer',
  imports: [QaCallReport],
  template: `
    <app-qa-call-report
      lane="closer"
      peopleLabel="Closers"
      subtitle="Live-call issues QA has flagged for each Closer — repeat offenders, trend and full comment history."
    />
  `,
})
export class QaLiveCallCloser {}
