import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WindowCloseDialog } from '../WindowCloseDialog';

describe('R006.1.3 close confirmation UI', () => {
  it('offers Save and close or Cancel for unfinished practice', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <WindowCloseDialog
        state={{ phase: 'CONFIRMING' }}
        onSave={onSave}
        onCancel={onCancel}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: '关闭应用' })).toHaveTextContent('当前练习尚未完成。');
    fireEvent.click(screen.getByRole('button', { name: '保存并关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders visible pending feedback and disables duplicate actions while saving', () => {
    render(
      <WindowCloseDialog
        state={{ phase: 'SAVING' }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: '关闭应用' })).toHaveTextContent('正在保存并关闭');
    expect(screen.getByRole('button', { name: '正在保存…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
  });

  it('keeps the failure visible and offers retry or cancel without force-discard', () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    render(
      <WindowCloseDialog
        state={{ phase: 'FAILED', error: '磁盘暂时不可写' }}
        onSave={vi.fn()}
        onCancel={onCancel}
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent('磁盘暂时不可写');
    expect(screen.queryByRole('button', { name: /强制|丢弃/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试保存并关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
