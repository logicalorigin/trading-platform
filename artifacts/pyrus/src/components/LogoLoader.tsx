import BrandLoader, {
  type BrandLoaderProps,
  type BrandLoaderTone,
} from "./BrandLoader";

type LogoLoaderTone = BrandLoaderTone;

type LogoLoaderProps = BrandLoaderProps & {
  tone?: LogoLoaderTone;
};

export function LogoLoader({
  testId = "logo-loader",
  ...props
}: LogoLoaderProps) {
  return <BrandLoader testId={testId} {...props} />;
}

export default LogoLoader;
