import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { i18n, type MessageDescriptor } from '@lingui/core';

export const appMetaTags = (title?: MessageDescriptor) => {
  const description = 'D2DHQ document signing.';

  return [
    {
      title: title ? `${i18n._(title)} - D2DHQ` : 'D2DHQ',
    },
    {
      name: 'description',
      content: description,
    },
    {
      name: 'author',
      content: 'D2DHQ',
    },
    {
      name: 'robots',
      content: 'noindex, nofollow',
    },
    {
      property: 'og:title',
      content: 'D2DHQ',
    },
    {
      property: 'og:description',
      content: description,
    },
    {
      property: 'og:type',
      content: 'website',
    },
  ];
};
