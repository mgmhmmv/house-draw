/** /s/<token>: a "Share to IslePOS" link opened in a browser. The link is for pasting into IslePOS. */
import { Logo } from '../ui';

export default function SharePage() {
  return (
    <div className="flex h-screen-safe flex-col items-center justify-center gap-4 bg-page px-6 text-center">
      <Logo size={28} withWord />
      <h1 className="text-lg font-semibold text-ink">A design shared to IslePOS</h1>
      <p className="max-w-md text-sm text-ink-2">
        This link is for the IslePOS Solar Suite. Open a solar project there, go to Drawings → Maavadiyaa, and paste this link to bring in the design: strings, measured cable runs, drawings and the 3D view.
      </p>
    </div>
  );
}
