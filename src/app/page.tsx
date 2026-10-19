import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  Dumbbell,
  Activity,
  Users,
  CalendarDays,
  Sparkles,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { Brand } from '@/components/ui';
import './landing.css';

export default function Home() {
  return (
    <div className="landing">
      <a href="#main" className="landing-skip">
        Skip to content
      </a>
      <header className="landing-header">
        <Link href="/" aria-label="Geez Squad home">
          <Brand />
        </Link>
        <nav aria-label="Main navigation">
          <a href="#experience">The experience</a>
          <a href="#programs">Our programs</a>
          <a href="#squad">The squad</a>
        </nav>
        <div>
          <Link className="landing-login" href="/login">
            Member login
            <ArrowUpRight size={15} />
          </Link>
          <Link className="landing-button" href="/demo">
            Explore the studio
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>
      <main id="main">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="landing-eyebrow">
              <span />
              YOUR PEOPLE. YOUR PACE. YOUR PROGRESS.
            </span>
            <h1>
              Find your
              <br />
              strength.
              <br />
              <span>Find your squad.</span>
            </h1>
            <p>
              A little encouragement. A stronger everyday.
              <br />
              Training, coaching, and a community that shows up with you — in the studio and
              wherever life takes you.
            </p>
            <div className="landing-hero-actions">
              <Link href="/login" className="landing-button large">
                Start your next chapter
                <ArrowUpRight size={19} />
              </Link>
              <a href="#experience" className="landing-text-link">
                <span className="landing-play">
                  <Play size={14} />
                </span>
                Get to know us
              </a>
            </div>
            <div className="landing-hero-proof">
              <div className="landing-initials">
                <span>PS</span>
                <span>AN</span>
                <span>MK</span>
              </div>
              <p>
                Different journeys.
                <br />
                <strong>One squad behind you.</strong>
              </p>
              <span className="landing-proof-star">✳</span>
            </div>
          </div>
          <div className="landing-hero-visual">
            <Image
              className="landing-hero-photo"
              src="/images/studio-hero.png"
              alt="Athletes training together at a boutique strength studio"
              fill
              sizes="(max-width: 800px) 90vw, 45vw"
              preload
            />
            <div className="landing-photo-label">
              <span />
              MAKE ROOM FOR A STRONGER YOU.
            </div>
            <div className="landing-hero-sticker">
              GOOD ENERGY.
              <br />
              GREAT PEOPLE.<span>↗</span>
            </div>
            <div className="landing-photo-card">
              <span>
                <Activity size={22} />
              </span>
              <div>
                <strong>Progress feels better together.</strong>
                <small>Real coaching. Every step of the way.</small>
              </div>
            </div>
          </div>
        </section>
        <div className="landing-marquee" aria-label="Strength, movement, community">
          <span>STRENGTH</span>
          <span>✳</span>
          <span>MOVEMENT</span>
          <span>✳</span>
          <span>COMMUNITY</span>
          <span>✳</span>
          <span>CONSISTENCY</span>
          <span>✳</span>
          <span>GEEZ SQUAD</span>
        </div>
        <section className="landing-experience" id="experience">
          <div className="landing-section-title">
            <span className="landing-eyebrow">MORE THAN A PLACE TO WORK OUT</span>
            <h2>
              A studio that fits
              <br />
              your <em>whole journey.</em>
            </h2>
            <p>
              Your goals evolve. Your training should too. From that very first session to your next
              personal best, we make showing up feel a little easier.
            </p>
          </div>
          <div className="landing-feature-grid">
            {[
              {
                n: '01',
                icon: Dumbbell,
                title: 'Train with intention.',
                text: 'Build strength and confidence with structured training, thoughtful workout plans, and room to grow.',
                tag: 'YOUR TRAINING',
              },
              {
                n: '02',
                icon: Users,
                title: 'Find your people.',
                text: 'The energy of a group. The attention of a coach. A welcoming squad that makes every session count.',
                tag: 'YOUR COMMUNITY',
              },
              {
                n: '03',
                icon: CalendarDays,
                title: 'Keep life in balance.',
                text: 'Your memberships, upcoming sessions, and progress in one connected member workspace.',
                tag: 'YOUR STUDIO, CONNECTED',
              },
            ].map((f) => (
              <article className="landing-feature" key={f.n}>
                <div>
                  <span>{f.n}</span>
                  <f.icon size={28} strokeWidth={1.4} />
                </div>
                <span className="landing-eyebrow">{f.tag}</span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-programs" id="programs">
          <div className="landing-program-heading">
            <div>
              <span className="landing-eyebrow">GOOD MOVEMENT. YOUR WAY.</span>
              <h2>Make your next move.</h2>
            </div>
            <p>
              Meet yourself where you are.
              <br />
              We’ll help you get where you want to go.
            </p>
          </div>
          <div className="landing-program-grid">
            {[
              {
                n: '01',
                title: 'Strength & conditioning',
                text: 'Build a stronger foundation for everything you do.',
                label: 'BUILD YOUR FOUNDATION',
                icon: Dumbbell,
              },
              {
                n: '02',
                title: 'Personal coaching',
                text: 'Focused guidance. A plan built around your goals.',
                label: 'MAKE IT PERSONAL',
                icon: Sparkles,
              },
              {
                n: '03',
                title: 'Live & connected',
                text: 'Keep your coaching close, wherever you train.',
                label: 'TAKE YOUR SQUAD WITH YOU',
                icon: Activity,
              },
            ].map((p, i) => (
              <Link className={`landing-program program-${i}`} href="/login" key={p.n}>
                <span className="landing-eyebrow">{p.label}</span>
                <div className="landing-program-art">
                  <p.icon size={100} strokeWidth={0.8} />
                  <span>{p.n}</span>
                </div>
                <div>
                  <h3>{p.title}</h3>
                  <ArrowUpRight size={25} />
                </div>
                <p>{p.text}</p>
              </Link>
            ))}
          </div>
        </section>
        <section className="landing-connected" id="squad">
          <div className="landing-connected-copy">
            <span className="landing-eyebrow">ONE SQUAD. EVERYTHING CONNECTED.</span>
            <h2>
              Less friction.
              <br />
              <em>More momentum.</em>
            </h2>
            <p>
              A great studio experience goes beyond the workout. Stay close to your coach, find your
              next session, and see the progress you’re making.
            </p>
            <ul>
              {[
                'Your sessions and training plans, together',
                'Progress you can look back on',
                'Human coaching, in the studio and online',
              ].map((t) => (
                <li key={t}>
                  <span>
                    <Check size={15} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <Link className="landing-button" href="/demo">
              Step inside the studio
              <ArrowUpRight size={17} />
            </Link>
          </div>
          <div
            className="landing-workspace-preview"
            aria-label="Illustrative preview of the studio dashboard"
          >
            <div className="landing-preview-top">
              <Brand />
              <span className="landing-preview-pill">STUDIO PREVIEW</span>
            </div>
            <div className="landing-preview-heading">
              <span>YOUR STUDIO, AT A GLANCE</span>
              <h3>A stronger studio starts here.</h3>
              <p>One place for your people and your progress.</p>
            </div>
            <div className="landing-preview-stats">
              <div>
                <Users size={18} />
                <span>Members</span>
                <strong>Your squad.</strong>
              </div>
              <div>
                <CalendarDays size={18} />
                <span>Sessions</span>
                <strong>Your rhythm.</strong>
              </div>
            </div>
            <div className="landing-preview-agenda">
              <span className="landing-eyebrow">A LITTLE STRUCTURE. A LOT OF POSSIBILITY.</span>
              {['Memberships & renewals', 'Classes & live coaching', 'Studio attendance'].map(
                (s) => (
                  <div key={s}>
                    <span className="landing-preview-check">
                      <Check size={16} />
                    </span>
                    <strong>{s}</strong>
                    <ArrowUpRight size={15} />
                  </div>
                ),
              )}
            </div>
            <div className="landing-preview-bottom">
              <ShieldCheck size={17} />
              Thoughtfully connected. Ready when you are.
            </div>
          </div>
        </section>
        <section className="landing-cta">
          <span className="landing-cta-star">✳</span>
          <span className="landing-eyebrow">YOUR NEXT CHAPTER STARTS WITH ONE STEP.</span>
          <h2>
            Come as you are.
            <br />
            Leave a little <em>stronger.</em>
          </h2>
          <Link className="landing-button" href="/login">
            Find your squad
            <ArrowUpRight size={20} />
          </Link>
          <p>
            Already part of the squad?{' '}
            <Link href="/login">
              Head to your workspace
              <ArrowRight size={14} />
            </Link>
          </p>
        </section>
      </main>
      <footer className="landing-footer">
        <Link href="/">
          <Brand />
        </Link>
        <p>Move better. Live stronger. Together.</p>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/login">
            Member login
            <ArrowUpRight size={14} />
          </Link>
          <span>© {new Date().getFullYear()} Geez Squad</span>
        </div>
      </footer>
    </div>
  );
}
