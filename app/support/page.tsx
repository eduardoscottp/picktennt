"use client";

import { FormEvent, useState } from "react";

const supportEmail = "info@picktennt.com";

export default function SupportPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  function startEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const subject = encodeURIComponent("Picktennt support request");
    const body = encodeURIComponent(
      `Name: ${name}\nEmail: ${email}\n\n${message}`
    );
    window.location.href = `mailto:${supportEmail}?subject=${subject}&body=${body}`;
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-12 text-slate-900 sm:py-20">
      <section className="mx-auto max-w-xl rounded-3xl bg-white p-7 shadow-sm ring-1 ring-slate-200 sm:p-10">
        <p className="text-sm font-semibold tracking-[0.18em] text-brand-600">PICKTENNT SUPPORT</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">How can we help?</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Send us a message about the Picktennt app, your account, or a match. We will reply by email.
        </p>

        <form className="mt-8 space-y-5" onSubmit={startEmail}>
          <label className="block text-sm font-semibold text-slate-700" htmlFor="name">
            Name
            <input
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              id="name"
              name="name"
              autoComplete="name"
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>

          <label className="block text-sm font-semibold text-slate-700" htmlFor="email">
            Email
            <input
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              value={email}
            />
          </label>

          <label className="block text-sm font-semibold text-slate-700" htmlFor="message">
            Message
            <textarea
              className="mt-2 min-h-36 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-base outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100"
              id="message"
              name="message"
              onChange={(event) => setMessage(event.target.value)}
              required
              value={message}
            />
          </label>

          <button className="w-full rounded-xl bg-brand-500 px-5 py-3 font-bold text-white transition hover:bg-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-200" type="submit">
            Send message
          </button>
        </form>

        <p className="mt-6 text-sm leading-6 text-slate-500">
          If your email app does not open, contact us directly at{" "}
          <a className="font-semibold text-brand-600 underline" href={`mailto:${supportEmail}`}>
            {supportEmail}
          </a>.
        </p>
      </section>
    </main>
  );
}
