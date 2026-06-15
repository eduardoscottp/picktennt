export const metadata = {
  title: "Privacy Policy – Picktennt",
};

export default function PrivacyPage() {
  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: 760,
      margin: "0 auto",
      padding: "40px 24px 80px",
      color: "#1a1a1a",
      lineHeight: 1.7,
    }}>
      <h1 style={{ color: "#2aacbe", fontSize: "2rem", marginBottom: 4 }}>Privacy Policy</h1>
      <p style={{ fontSize: "0.85rem", color: "#888", marginBottom: 32 }}>Last updated: June 15, 2026</p>

      <p>Picktennt ("we", "our", or "us") is a pickleball scoreboard and health tracking app for Android and Wear OS, developed by Idddeas. This policy explains what data we collect, how we use it, and your rights.</p>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>1. Information We Collect</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li><strong>Account information:</strong> When you sign in with Google, we receive your name, email address, and Google account identifier.</li>
        <li><strong>Match data:</strong> Scores, results, serving position, and match history you record in the app.</li>
        <li><strong>Health data:</strong> Heart rate and activity metrics captured by your Wear OS device during matches. This data is stored locally on your devices and is not shared with third parties.</li>
        <li><strong>Usage data:</strong> Anonymous analytics about how you use the app (screens visited, features used) via Firebase Analytics.</li>
        <li><strong>Crash reports:</strong> Diagnostic data when the app crashes, collected via Firebase Crashlytics to help us fix bugs.</li>
      </ul>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>2. How We Use Your Information</h2>
      <ul style={{ paddingLeft: 20 }}>
        <li>To provide and sync your match history across your phone and watch.</li>
        <li>To display your performance stats and dashboard.</li>
        <li>To identify and fix bugs and crashes.</li>
        <li>To understand how the app is used and improve it over time.</li>
      </ul>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>3. Data Storage</h2>
      <p>Match history and account data are stored securely on our backend (Supabase), which uses encrypted PostgreSQL databases hosted on AWS infrastructure. Health data (heart rate) is stored only on your local devices and is never uploaded to our servers.</p>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>4. Data Sharing</h2>
      <p>We do not sell, rent, or trade your personal information. We share data only with the following service providers who help us operate the app:</p>
      <ul style={{ paddingLeft: 20 }}>
        <li><strong>Supabase</strong> – backend database and authentication</li>
        <li><strong>Google Firebase</strong> – analytics and crash reporting</li>
        <li><strong>Google Sign-In</strong> – authentication</li>
      </ul>
      <p>These providers are contractually obligated to keep your data confidential and use it only to provide their services to us.</p>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>5. Health Data</h2>
      <p>Heart rate and activity data collected via your Wear OS device during matches is used solely to display your health metrics within the app. This data is stored locally on your devices and is never shared with third parties or uploaded to our servers.</p>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>6. Data Retention</h2>
      <p>Your account and match data is retained as long as your account is active. You may request deletion of your data at any time by contacting us at the email below.</p>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>7. Your Rights</h2>
      <p>You have the right to access, correct, or delete your personal data. To make a request, contact us at <a href="mailto:sales@keenkaya.com" style={{ color: "#2aacbe" }}>sales@keenkaya.com</a>.</p>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>8. Children&apos;s Privacy</h2>
      <p>Picktennt is not directed at children under 13. We do not knowingly collect personal information from children under 13.</p>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>9. Changes to This Policy</h2>
      <p>We may update this policy from time to time. We will notify you of significant changes by updating the date at the top of this page.</p>

      <h2 style={{ fontSize: "1.1rem", marginTop: 36, color: "#0a1c36" }}>10. Contact</h2>
      <p>If you have any questions about this privacy policy, contact us at:<br/>
      <a href="mailto:sales@keenkaya.com" style={{ color: "#2aacbe" }}>sales@keenkaya.com</a></p>
    </div>
  );
}
