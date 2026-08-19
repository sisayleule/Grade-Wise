'use client';
import { useMemo } from 'react';
import Chart from 'react-apexcharts';

const baseColors = ['#422AFB', '#4318FF', '#A195FD', '#7551FF', '#FFB547'];

export default function Charts({
  type,
  series,
  categories,
  dark = false,
  height = 300,
  distributed = false,
}: {
  type: 'bar' | 'area' | 'line';
  series: any[];
  categories: string[];
  dark?: boolean;
  height?: number;
  distributed?: boolean;
}) {
  const options = useMemo(() => {
    const isBar = type === 'bar';
    return {
      chart: {
        type,
        fontFamily: "'DM Sans', sans-serif",
        toolbar: { show: false },
        zoom: { enabled: false },
        foreColor: '#A3AED0',
        background: 'transparent',
      },
      colors: baseColors,
      dataLabels: { enabled: false },
      stroke: { curve: 'smooth', width: 3 },
      fill: isBar
        ? { opacity: 0.95 }
        : {
            type: 'gradient',
            gradient: {
              shadeIntensity: 1,
              opacityFrom: 0.45,
              opacityTo: 0.05,
              stops: [0, 90, 100],
            },
          },
      grid: {
        borderColor: dark ? 'rgba(255,255,255,0.08)' : '#E9EDF7',
        strokeDashArray: 5,
        padding: { left: 8, right: 8 },
      },
      ...(isBar
        ? { plotOptions: { bar: { borderRadius: 8, columnWidth: '40%', distributed } } }
        : {}),
      xaxis: {
        categories,
        axisBorder: { show: false },
        axisTicks: { show: false },
        labels: {
          style: {
            colors: '#A3AED0',
            fontSize: '12px',
            fontFamily: "'DM Sans', sans-serif",
          },
        },
      },
      yaxis: {
        max: 100,
        labels: {
          style: {
            colors: '#A3AED0',
            fontSize: '12px',
            fontFamily: "'DM Sans', sans-serif",
          },
          formatter: (v: number) => `${Math.round(v)}%`,
        },
      },
      legend: {
        show: true,
        position: 'bottom',
        horizontalAlign: 'center',
        labels: { colors: '#A3AED0' },
        markers: { size: 6, strokeWidth: 0 },
        itemMargin: { horizontal: 8 },
      },
      tooltip: { theme: dark ? 'dark' : 'light' },
    };
  }, [type, categories, dark, distributed]);

  return (
    <Chart
      options={options as any}
      series={series}
      type={type as any}
      width="100%"
      height={height}
    />
  );
}
