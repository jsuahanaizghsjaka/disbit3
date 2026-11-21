// Explicit delivery drill: no disk writes and no changes to monitoring state.
import { monitorIssues } from './monitor.mjs';
import { sendMail, isEmailFormatValid } from '../backend/lib/email.js';

const recipient = process.env.MONITOR_EMAIL;
if (!process.argv.includes('--send-test') || !isEmailFormatValid(recipient || '')) {
  console.error('Supply --send-test and configure MONITOR_EMAIL with the existing mail environment.');
  process.exitCode = 1;
} else {
  try {
    for (const [name, disk, expected] of [
      ['disk:low', { percent: 95, available: 512 * 1024 ** 2 }, true],
      ['disk:recovered', { percent: 50, available: 8 * 1024 ** 3 }, false]
    ]) {
      const issues = monitorIssues({ checks: {}, disk, units: {}, mailFailures: 0 });
      if (issues.includes('disk:low') !== expected) throw Error('Disk threshold assertion failed');
      const result = await sendMail(recipient, `Disbit: ТЕСТ ${name}`,
        `<h2>Учебная проверка: ${name}</h2><p>Это искусственные показатели, а не реальное заполнение диска.</p><p>Занято: ${disk.percent}%. Свободно: ${disk.available / 1024 ** 2} МБ.</p><p>Реальные файлы и состояние мониторинга не изменялись.</p>`);
      if (!result.sent) throw Error('Notification not sent');
      console.log(JSON.stringify({ scenario: name, notificationSent: true, simulated: true }));
    }
  } catch {
    console.error('Disk drill failed; check mail configuration and delivery.');
    process.exitCode = 1;
  }
}
