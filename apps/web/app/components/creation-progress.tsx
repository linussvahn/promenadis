import { type Locale, translate } from "@promenadis/i18n";

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
    <nav aria-label={translate(locale, "creation.progressLabel")} className="creation-progress">
      <ol>
        {steps.map((step, index) => {
          const number = index + 1;
          return (
            <li
              aria-current={number === currentStep ? "step" : undefined}
              className={number < currentStep ? "is-complete" : undefined}
              key={step}
            >
              <span aria-hidden="true" className="progress-number">
                {number < currentStep ? "✓" : number}
              </span>
              {step}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
