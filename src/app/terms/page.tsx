import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';

export const metadata: Metadata = { title: 'Terms' };

/**
 * Operator-specific values. They have no configuration source yet, so they render as visible
 * placeholders. The operator (with legal review) must replace them before accepting real customers.
 */
const operator = {
  legalName: '[Operator legal entity name]',
  governingLaw: '[Governing law and jurisdiction]',
  contactAddress: '[Operator contact email and postal address]',
  effectiveDate: '[Effective date]',
};

function Placeholder({ children }: { children: string }) {
  return <mark>{children}</mark>;
}

export default function TermsPage() {
  return (
    <main className="privacy-page">
      <Link href="/">
        <Brand />
      </Link>
      <span className="eyebrow">TRAIN WITH CARE. TRAIN TOGETHER.</span>
      <h1>Terms of service.</h1>
      <p>
        <strong>Draft for operator and legal review.</strong> These terms describe how the current
        Geez Squad implementation works. Highlighted items must be completed by the operator, and
        the full text reviewed by a qualified lawyer, before real customers use the service.
      </p>
      <p>
        Geez Squad is provided by <Placeholder>{operator.legalName}</Placeholder> (“we”, “us”).
        Effective <Placeholder>{operator.effectiveDate}</Placeholder>.
      </p>

      <h2>Who the service is for</h2>
      <p>
        Geez Squad connects fitness studios with their members for classes, memberships, live video
        coaching and on-device movement feedback. It is for adults 18 and over. By creating an
        account you confirm that you are at least 18 and that you accept these terms and the{' '}
        <Link href="/privacy">privacy guide</Link>.
      </p>

      <h2>Studios and trainees</h2>
      <p>
        <strong>Studios</strong> (owners, admins and coaches) are responsible for the classes,
        plans, coaching notes, memberships and prices they publish, for the qualifications of the
        coaches they invite, for the members they admit, and for their own payment, attendance and
        membership records. A job title shown in the app does not grant extra access; studios manage
        access through roles and assignments.
      </p>
      <p>
        <strong>Trainees</strong> are responsible for the information they enter, for choosing
        exercise that suits their health and ability, and for following their coach’s instructions
        and their own judgement. Your agreement for classes, memberships and payments is with your
        studio.
      </p>

      <h2>Camera use</h2>
      <p>
        Camera access is requested only when you turn the camera on. Pose analysis runs on your
        device: camera frames are not uploaded for analysis and are not recorded. Limited movement
        summaries (such as rep counts, estimated form score, tracking confidence, exercise and
        feedback) can be saved while you are in a live class, or in practice when you enable saved
        history. Raw camera frames and body landmarks are not stored with your history.
      </p>
      <p>
        When you consent and join a live group class, your camera and microphone streams are carried
        over LiveKit to the other enrolled participants in that class. They can see and hear your
        enabled devices. You can mute, switch off your camera or leave at any time. The app does not
        record classes. The <Link href="/privacy">privacy guide</Link> describes what is stored, who
        can see it and how long it is kept.
      </p>

      <h2>Not medical advice; exercise risk</h2>
      <p>
        Coaching, plans, nutrition targets and automatic feedback support general fitness only. They
        are not medical advice, diagnosis or treatment. Automatic exercise counting and form scores
        are beta, heuristic estimates; they can be wrong and cannot measure pain, joint loading or
        injury. Physical exercise carries a risk of injury. Check with a qualified health
        professional before starting if you have a medical condition, injury or doubt, and stop if
        you feel pain, dizziness or discomfort.
      </p>

      <h2>Accounts and termination</h2>
      <p>
        Keep your sign-in details private and tell your studio or us if you think your account has
        been misused. You can download your data and delete your account in Settings. Studio owners
        must contact us to close a studio, because closing it affects its members and records. We or
        your studio may suspend or remove access that breaks these terms or puts other people at
        risk.
      </p>

      <h2>Acceptable use</h2>
      <ul>
        <li>Do not harass, threaten or discriminate against other participants.</li>
        <li>Do not record, capture or share other participants’ video, audio or messages.</li>
        <li>Do not post medical or other sensitive information in group messages.</li>
        <li>
          Do not try to access another person’s account, studio or data, or to disrupt, probe or
          overload the service.
        </li>
        <li>Do not use the service for anything unlawful.</li>
      </ul>

      <h2>Limits of liability</h2>
      <p>
        The service is provided “as is” and “as available”. Live video, counting and saving depend
        on your device, browser and connection, and can be interrupted. To the extent the law
        allows, we are not liable for indirect or consequential loss, or for injury arising from
        exercise you choose to perform. Nothing in these terms limits liability that cannot be
        limited by law. These terms are governed by{' '}
        <Placeholder>{operator.governingLaw}</Placeholder>.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms as the service changes. We will show the new effective date on
        this page and, for significant changes, tell signed-in users before they take effect.
        Continuing to use the service after that means you accept the updated terms.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <Placeholder>{operator.contactAddress}</Placeholder>. For
        questions about classes, memberships or payments, contact your studio first.
      </p>

      <Link href="/" className="text-link">
        <ArrowLeft size={16} /> Back to Geez Squad
      </Link>
    </main>
  );
}
