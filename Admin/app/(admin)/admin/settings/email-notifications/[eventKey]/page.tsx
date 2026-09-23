import { EmailNotificationEditClient } from './EmailNotificationEditClient';

export default function AdminEmailNotificationEditPage({
  params,
}: {
  params: { eventKey: string };
}) {
  return <EmailNotificationEditClient eventKey={params.eventKey} />;
}
