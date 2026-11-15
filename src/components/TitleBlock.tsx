import React from 'react';
import { ProjectMeta } from '../model/types';

interface TitleBlockProps {
  meta: ProjectMeta;
  sheetNo: string;
  sheetTitle: string;
  discipline: string;
  compact?: boolean;
  isLight?: boolean;
}

export const TitleBlock: React.FC<TitleBlockProps> = ({
  meta,
  sheetNo,
  sheetTitle,
  discipline,
  compact = false,
  isLight = true,
}) => {
  return (
    <div
      className={`border font-mono text-[11px] flex flex-wrap items-stretch justify-between print:bg-white print:text-black print:border-black ${
        isLight
          ? 'border-slate-300 bg-white text-slate-800'
          : 'border-slate-700/80 bg-slate-900/90 text-slate-200'
      } ${compact ? 'px-3 py-1.5' : 'px-4 py-2'}`}
    >
      <div
        className={`flex items-center gap-4 pr-4 border-r print:border-black ${
          isLight ? 'border-slate-300' : 'border-slate-700/70'
        }`}
      >
        <div
          className={`w-8 h-8 rounded flex items-center justify-center font-bold border print:text-black print:border-black ${
            isLight
              ? 'bg-sky-50 border-sky-300 text-sky-700'
              : 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
          }`}
        >
          AS
        </div>
        <div>
          <div
            className={`text-[10px] uppercase tracking-wider print:text-neutral-600 ${
              isLight ? 'text-slate-500' : 'text-slate-400'
            }`}
          >
            {meta.architect}
          </div>
          <div className={`font-semibold text-xs print:text-black ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
            {meta.title}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-5 px-4 flex-1">
        <div>
          <span className={`text-[9px] uppercase block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Sheet Title
          </span>
          <span className={`font-semibold print:text-black ${isLight ? 'text-sky-700' : 'text-cyan-300'}`}>
            {sheetTitle}
          </span>
        </div>
        <div>
          <span className={`text-[9px] uppercase block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Discipline
          </span>
          <span>{discipline}</span>
        </div>
        <div>
          <span className={`text-[9px] uppercase block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Project / Client
          </span>
          <span>
            {meta.projectCode} · {meta.client}
          </span>
        </div>
        <div>
          <span className={`text-[9px] uppercase block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Scale / Date
          </span>
          <span>
            {meta.scale} · {meta.date}
          </span>
        </div>
      </div>

      <div
        className={`flex items-center gap-3 pl-4 border-l print:border-black ${
          isLight ? 'border-slate-300' : 'border-slate-700/70'
        }`}
      >
        <div className="text-right">
          <span className={`text-[9px] uppercase block ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Revision
          </span>
          <span className={`print:text-black ${isLight ? 'text-amber-700 font-semibold' : 'text-amber-300'}`}>
            {meta.revision.split(' ')[0]}
          </span>
        </div>
        <div
          className={`px-3 py-1 rounded border text-center print:bg-neutral-100 print:border-black ${
            isLight ? 'bg-slate-100 border-slate-300' : 'bg-slate-800 border-slate-600'
          }`}
        >
          <div className={`text-[9px] uppercase leading-none ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            Sheet
          </div>
          <div className={`text-sm font-bold print:text-black ${isLight ? 'text-slate-900' : 'text-white'}`}>
            {sheetNo}
          </div>
        </div>
      </div>
    </div>
  );
};
