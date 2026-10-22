import { connectImapAction, disconnectImapAction } from "@/lib/actions";
import { imapAccount } from "@/lib/mail/imap";
import { SubmitButton } from "./SubmitButton";

/** Connect any mailbox with an app password (Gmail, iCloud, Yahoo, Fastmail, or a custom IMAP server). */
export function ImapConnect({ next }: { next: "setup" | "settings" }) {
  const account = imapAccount();
  if (account) {
    return (
      <div className="flex items-center gap-3">
        <span className="flex-1 text-sm text-fg-2">
          Connected to {account.email} · read-only
        </span>
        <form action={disconnectImapAction}>
          <button type="submit" className="btn btn-ghost btn-sm">
            Disconnect
          </button>
        </form>
      </div>
    );
  }
  return (
    <form action={connectImapAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] text-fg-2">
        <li>
          Turn on 2-step verification for your email account, then create an <span className="text-fg">app password</span>:{" "}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="btn-link">
            Gmail
          </a>
          {" · "}
          <a href="https://account.apple.com/account/manage" target="_blank" rel="noreferrer" className="btn-link">
            iCloud
          </a>
          {" · "}
          <a href="https://login.yahoo.com/account/security" target="_blank" rel="noreferrer" className="btn-link">
            Yahoo
          </a>
          {" · "}
          <a href="https://app.fastmail.com/settings/security/apps" target="_blank" rel="noreferrer" className="btn-link">
            Fastmail
          </a>
          .
        </li>
        <li>Enter your address and paste the app password. Pursuit only reads your Inbox; it never sends, moves or deletes anything.</li>
      </ol>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`imap-email-${next}`} className="label">
            Email address
          </label>
          <input id={`imap-email-${next}`} name="email" type="email" className="input" placeholder="you@gmail.com" autoComplete="email" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`imap-password-${next}`} className="label">
            App password
          </label>
          <input id={`imap-password-${next}`} name="password" type="password" className="input" placeholder="xxxx xxxx xxxx xxxx" autoComplete="off" required />
        </div>
      </div>
      <details className="text-[13px] text-fg-2">
        <summary className="cursor-pointer text-muted">Advanced: another provider</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_120px]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`imap-host-${next}`} className="label">
              IMAP server
            </label>
            <input id={`imap-host-${next}`} name="host" className="input" placeholder="imap.example.com" autoComplete="off" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`imap-port-${next}`} className="label">
              Port
            </label>
            <input id={`imap-port-${next}`} name="port" inputMode="numeric" className="input" placeholder="993" autoComplete="off" />
          </div>
        </div>
      </details>
      <div>
        <SubmitButton pending="Connecting…">Connect email</SubmitButton>
      </div>
    </form>
  );
}
