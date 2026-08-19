const SidebarCard = () => {
  return (
    <div className="relative mt-14 flex w-[256px] justify-center rounded-[20px] bg-gradient-to-br from-[#868CFF] via-[#432CF3] to-brand-500 pb-4">
      <div className="absolute -top-12 flex h-24 w-24 items-center justify-center rounded-full border-[4px] border-white bg-gradient-to-b from-[#868CFF] to-brand-500 dark:!border-navy-800">
        {/* GradeWise "G" monogram */}
        <span className="text-4xl font-black text-white select-none">G</span>
      </div>

      <div className="mt-16 flex h-fit flex-col items-center px-4 pb-2 text-center">
        <p className="text-lg font-bold text-white">GradeWise</p>
        <p className="mt-1 text-sm text-white/80">
          School Management System
        </p>
        <p className="mt-3 text-xs text-white/60 leading-relaxed">
          Manage results, generate reports, and track student performance — all in one place.
        </p>
      </div>
    </div>
  );
};

export default SidebarCard;
