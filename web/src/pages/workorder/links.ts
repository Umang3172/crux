// Links that survive a refresh and a QR scan: hash routes on this page's own address.

export function phoneFoundUrl(ticketId: string): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/phone/found/${encodeURIComponent(ticketId)}`;
}
