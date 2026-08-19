import React, { ReactNode } from 'react';
import type { Metadata } from 'next';
import AppWrappers from './AppWrappers';
// import '@asseinfo/react-kanban/dist/styles.css';
// import '/public/styles/Plugins.css';

export const metadata: Metadata = {
  title: 'GradeWise School Management System',
  description:
    'Upload result sheets, extract scores, generate reports, and track student performance — all in one place.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body id={'root'}>
        <AppWrappers>{children}</AppWrappers>
      </body>
    </html>
  );
}
