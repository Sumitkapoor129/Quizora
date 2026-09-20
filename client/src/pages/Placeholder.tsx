import { EmptyState } from '@/components/ui/EmptyState';

export interface PlaceholderProps {
  title: string;
  description: string;
}

export default function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <>
      <h1 className="page-heading">{title}</h1>
      <p className="page-sub">{description}</p>
      <EmptyState title="Coming soon" description="This area arrives in a later phase." />
    </>
  );
}