import { type Locale, translate } from "@promenadis/i18n";
import { cn } from "../lib/utils";

export function CreationProgress({
  currentStep,
  locale,
}: {
  readonly currentStep: 1 | 2 | 3;
  readonly locale: Locale;
}) {
  const steps = [
    translate(locale, "creation.progressBasics"),
    translate(locale, "creation.progressArea"),
    translate(locale, "creation.progressReview"),
  ];

  return (
    <nav aria-label={translate(locale, "creation.progressLabel")} className="pt-2">
      <ol className="isolate m-0 grid list-none grid-cols-3 p-0">
        {steps.map((step, index) => {
          const number = index + 1;
          const complete = number < currentStep;
          const current = number === currentStep;
          return (
            <li
              aria-current={current ? "step" : undefined}
              className={cn(
                "relative grid justify-items-center gap-2 px-1 text-center text-sm font-bold text-muted-foreground",
                "before:absolute before:top-4 before:right-1/2 before:-z-10 before:h-0.5 before:w-full before:bg-border first:before:content-none",
                (current || complete) && "text-foreground",
                complete && "before:bg-success",
              )}
              key={step}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-9 place-items-center rounded-full border-2 border-input bg-muted text-muted-foreground",
                  current && "border-primary bg-primary text-primary-foreground",
                  complete && "border-success bg-success text-primary-foreground",
                )}
              >
                {complete ? "✓" : number}
              </span>
              {step}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
