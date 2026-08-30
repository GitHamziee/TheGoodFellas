import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { LucideCircleCheck, LucideFlag, LucideUserCheck } from '@lucide/angular';
import { AuthService } from '../../../core/services/auth.service';
import { UserService } from '../../../core/services/user.service';
import { CallReviewService } from '../../../core/services/call-review.service';
import { CallReview } from '../../../core/models/review.model';
import { formatDateTime, getAvatarTone, getInitials, timeAgo } from '../../../core/format-utils';
import { EmptyState, SearchBox, SkeletonRows } from '../../../shared/ui/ui';

interface Person {
  id: string;
  name: string;
  email: string;
}

/**
 * Write a Review — the live-call QA flow: pick a person directly (no lead involved) and
 * flag what went wrong. There's no "pass" side — a call with nothing wrong just doesn't
 * get logged, so this is an issue log, not a rating. Mounted at both /qa-junior and
 * /qa-closer; the person list and label swap based on the logged-in user's role, same
 * lane-by-role pattern as the Review Queue/History pages.
 */
@Component({
  selector: 'app-qa-write-review',
  imports: [SearchBox, EmptyState, SkeletonRows, LucideUserCheck, LucideFlag, LucideCircleCheck],
  templateUrl: './write-review.html',
  styleUrl: '../review-queue/review-queue.css',
})
export class QaWriteReview implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly userService = inject(UserService);
  private readonly callReviewService = inject(CallReviewService);

  readonly lane = computed(() => (this.auth.role() === 'QA_JUNIOR_CLOSER' ? 'JUNIOR_CLOSER' : 'CLOSER'));
  readonly personLabel = computed(() => (this.lane() === 'JUNIOR_CLOSER' ? 'junior closer' : 'closer'));

  readonly people = signal<Person[]>([]);
  readonly loadingPeople = signal(true);
  readonly personSearch = signal('');

  readonly mine = signal<CallReview[]>([]);
  readonly loadingMine = signal(true);

  readonly chosenPersonId = signal<string | null>(null);
  readonly comment = signal('');
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly getInitials = getInitials;
  readonly getAvatarTone = getAvatarTone;
  readonly timeAgo = timeAgo;
  readonly formatDateTime = formatDateTime;

  readonly filteredPeople = computed(() => {
    const term = this.personSearch().trim().toLowerCase();
    const people = this.people();
    if (!term) return people;
    return people.filter((p) => p.name.toLowerCase().includes(term) || p.email.toLowerCase().includes(term));
  });

  async ngOnInit(): Promise<void> {
    this.loadingPeople.set(true);
    this.loadingMine.set(true);
    try {
      const [people, mine] = await Promise.all([
        this.lane() === 'JUNIOR_CLOSER' ? this.userService.listJuniorClosers() : this.userService.listClosers(),
        this.callReviewService.mine(),
      ]);
      this.people.set(people);
      this.mine.set(mine);
    } finally {
      this.loadingPeople.set(false);
      this.loadingMine.set(false);
    }
  }

  async submit(): Promise<void> {
    const personId = this.chosenPersonId();
    if (!personId) {
      this.error.set('Pick who this review is about');
      return;
    }
    if (!this.comment().trim()) {
      this.error.set('Describe what happened on the call');
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    try {
      const review = await this.callReviewService.submit(personId, this.comment());
      this.mine.update((rows) => [review, ...rows]);
      this.chosenPersonId.set(null);
      this.comment.set('');
    } catch {
      this.error.set('Could not save the review — try again.');
    } finally {
      this.submitting.set(false);
    }
  }
}
