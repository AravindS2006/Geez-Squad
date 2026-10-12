import Link from 'next/link';
import { Brand } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';
export default function PrivacyPage() {
  return (
    <main className="privacy-page">
      <Link href="/">
        <Brand />
      </Link>
      <span className="eyebrow">YOUR MOVEMENT. YOUR CHOICE.</span>
      <h1>A clear view of camera privacy.</h1>
      <p>
        This guide explains the current Geez Squad implementation. The studio operator must provide
        their legal privacy policy, contact information, and service terms before accepting real
        customers.
      </p>
      <h2>Local camera practice</h2>
      <p>
        The pose model runs on your device. Camera frames are not uploaded for analysis and are not
        recorded. The model estimates body landmarks and compares limited geometry rules. Browser
        camera permission is requested only when you enable the camera.
      </p>
      <h2>Joining a live group class</h2>
      <p>
        After you consent and join, LiveKit carries your camera and microphone streams to enrolled
        participants in that group class. This is a shared group experience: other participants can
        see and hear your enabled devices. You can mute, switch off your camera, or leave the video
        room. The app does not record classes.
      </p>
      <h2>Movement summaries</h2>
      <p>
        While you are enrolled and connected to a live class, limited summaries may be saved: rep
        counts, estimated form score, tracking confidence, exercise, phase, and feedback. Your coach
        and you can view your summaries. Other trainees cannot access your individual analytics
        through the app’s APIs. Scores are heuristic estimates, not proof of safe or perfect form.
      </p>
      <p>
        Completed or interrupted sets can retain observed training and hold time, range, tempo, rep
        quality, tracking coverage, rejected cycles, targets, and exercise rule version. Signed-in
        practice saves these summaries only when you enable saved history; they then become
        available to your coach. Failed saves are queued on this device for retry within 30 days.
        Raw camera frames and body landmarks are not stored with your history.
      </p>
      <h2>Coaching plans and check-ins</h2>
      <p>
        Your coach can assign workout plans and keep private coaching notes. Trainees may choose to
        share energy, soreness, workout effort, sleep, bodyweight, and a short note. These are
        self-reported values. Your check-ins are available to you and your coach; private coach
        notes are visible only to the coach.
      </p>
      <h2>Messages and coach feedback</h2>
      <p>
        Session messages are shared with the group. Cues addressed to one trainee are private to
        that trainee and the coach. Avoid posting medical information or other sensitive information
        in group messages.
      </p>
      <h2>Retention and your data</h2>
      <p>
        The included retention job removes latest camera summaries after 7 days and session messages
        after 90 days. Aggregated workout history remains until the studio operator processes a
        deletion request or sets a shorter retention policy. Saved set history, assignments, and
        check-ins follow this same policy. You can download your own profile and workout history in
        Settings. The operator must publish a working contact and data deletion process before
        launch.
      </p>
      <h2>Camera limitations and wellbeing</h2>
      <ul>
        <li>Use the instructed camera angle and keep the required joints visible.</li>
        <li>
          Keep only one person in view. This tracker follows one body and cannot reliably detect or
          reject additional people. Low visibility can interrupt scoring.
        </li>
        <li>Camera geometry cannot measure pain, joint loading, or diagnose injuries.</li>
        <li>
          Stop if you feel pain, dizziness, or discomfort; discuss suitable exercise with a
          qualified professional.
        </li>
      </ul>
      <h2>Security and providers</h2>
      <p>
        Production uses HTTPS, authenticated session access, and transport-encrypted live media.
        This implementation does not claim end-to-end encryption. PostgreSQL stores account and
        studio records. Stripe, if enabled, handles payment information directly. The operator must
        configure the selected vendors and publish the applicable privacy terms.
      </p>
      <Link href="/" className="text-link">
        <ArrowLeft size={16} /> Back to Geez Squad
      </Link>
    </main>
  );
}
