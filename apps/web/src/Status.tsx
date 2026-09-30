export function Status({ value }: { value: string }) {
  return (
    <span className="status" data-status={value}>
      <i />
      {value.replaceAll('_', ' ')}
    </span>
  );
}
