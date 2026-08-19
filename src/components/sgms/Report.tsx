'use client';
import { Result, School } from 'lib/grades';
export default function Report({
  student,
  subjects,
  school,
  year,
  grade,
  section,
  semester,
}: {
  student: Result;
  subjects: string[];
  school: School;
  year: string;
  grade: string;
  section: string;
  semester: string;
}) {
  return (
    <article className="print-report mx-auto max-w-[794px] bg-white p-6 text-navy-800 sm:p-10">
      <header className="mb-7 border-b-2 border-brand-600 pb-6 text-center">
        {school.logo ? (
          <img
            src={school.logo}
            className="mx-auto mb-2 h-12 w-12 rounded-full object-cover"
            alt="School logo"
          />
        ) : (
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-blueSecondary text-lg font-black text-white">
            {school.name.slice(0, 1)}
          </div>
        )}
        <h1 className="text-2xl font-bold text-navy-900">{school.name}</h1>
        <p className="text-sm text-gray-600">Official Academic Progress Report</p>
      </header>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
        <p>
          <b className="text-navy-900">Student:</b> {student.name}
        </p>
        <p>
          <b className="text-navy-900">Student ID:</b> {student.id}
        </p>
        <p>
          <b className="text-navy-900">Class:</b> {grade}
          {section}
        </p>
        <p>
          <b className="text-navy-900">Grade:</b> {grade}
        </p>
        <p>
          <b className="text-navy-900">Section:</b> {section}
        </p>
        <p>
          <b className="text-navy-900">Academic year:</b> {year}
        </p>
        <p>
          <b className="text-navy-900">Period:</b> {semester}
        </p>
        <p>
          <b className="text-navy-900">Rank:</b> {student.rank}
        </p>
      </div>
      <table className="mt-6 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-navy-900 text-left text-white">
            <th className="p-3 font-bold">Subject</th>
            <th className="p-3 text-right font-bold">Score</th>
            <th className="p-3 text-right font-bold">Maximum</th>
          </tr>
        </thead>
        <tbody>
          {subjects.map((s) => (
            <tr key={s} className="border-b border-gray-200">
              <td className="p-3">{s}</td>
              <td className="p-3 text-right font-bold text-navy-900">
                {student.scores[s]}
              </td>
              <td className="p-3 text-right">100</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Stat label="Total" value={`${student.total}/${student.maximum}`} />
        <Stat label="Average" value={student.average.toFixed(1)} />
        <Stat label="Percentage" value={`${student.percentage.toFixed(1)}%`} />
        <Stat label="Remark" value={student.status} />
      </div>
      <footer className="mt-14 grid grid-cols-2 gap-10 text-center text-sm">
        <div className="border-t-2 border-gray-300 pt-2">
          {school.teacher}
          <br />
          <span className="text-gray-600">Class Teacher</span>
        </div>
        <div className="border-t-2 border-gray-300 pt-2">
          {school.principal}
          <br />
          <span className="text-gray-600">Principal / Authorized Person</span>
        </div>
      </footer>
      <p className="mt-8 text-center text-xs text-gray-600">
        {school.footer} · Generated {new Date().toLocaleDateString()}
      </p>
    </article>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-brand-50 p-3">
      <p className="text-xs uppercase tracking-wide text-gray-600">{label}</p>
      <p className="mt-1 font-bold text-navy-900">{value}</p>
    </div>
  );
}
